// Text tokenization + speech-alignment helpers for the teleprompter.

export interface ScriptWord {
  /** Word as it should be displayed (original casing + trailing punctuation). */
  display: string
  /** Normalized form used for matching against speech. */
  clean: string
  /** Index of the display line this word belongs to. */
  lineIndex: number
  /** Index of the sentence this word belongs to. */
  sentenceIndex: number
  /**
   * Inclusive last word index the matcher is allowed to scan to from this
   * word: the end of the *next* sentence. This keeps voice tracking local so a
   * repeated common word can never jump you into a far-off section.
   */
  scanLimit: number
}

export interface ScriptLine {
  text: string
  /** Global index of the first word in this line. */
  startWord: number
  /** Global index of the last word in this line. */
  endWord: number
}

export interface ParsedScript {
  words: ScriptWord[]
  lines: ScriptLine[]
}

const MAX_CHARS_PER_LINE = 52

/** Strip punctuation, lowercase, and normalize a spoken/script token for matching. */
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9']/g, "")
    .replace(/^'+|'+$/g, "")
}

/** True when a display token closes a sentence (ends with . ! ? or … ). */
function endsSentence(token: string): boolean {
  return /[.!?…]["')\]]*$/.test(token)
}

/** Break raw pasted text into display lines and a flat word list. */
export function parseScript(raw: string): ParsedScript {
  const words: ScriptWord[] = []
  const lines: ScriptLine[] = []

  const paragraphs = raw
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  let sentenceIndex = 0

  for (const paragraph of paragraphs) {
    const tokens = paragraph.split(/\s+/).filter(Boolean)
    let current: string[] = []
    let currentLen = 0

    const flush = () => {
      if (current.length === 0) return
      const lineIndex = lines.length
      const startWord = words.length
      for (const token of current) {
        words.push({
          display: token,
          clean: normalizeWord(token),
          lineIndex,
          sentenceIndex,
          scanLimit: 0, // filled in after all words are known
        })
        if (endsSentence(token)) sentenceIndex++
      }
      lines.push({
        text: current.join(" "),
        startWord,
        endWord: words.length - 1,
      })
      current = []
      currentLen = 0
    }

    for (const token of tokens) {
      const addLen = token.length + (current.length > 0 ? 1 : 0)
      if (currentLen + addLen > MAX_CHARS_PER_LINE && current.length > 0) {
        flush()
      }
      current.push(token)
      currentLen += token.length + (current.length > 1 ? 1 : 0)
    }
    // A paragraph break always ends the current sentence.
    if (current.length > 0 && !endsSentence(current[current.length - 1])) {
      // Mark the last token of the paragraph as a sentence end so the next
      // paragraph starts a fresh sentence for scan-bounding purposes.
      flush()
      sentenceIndex++
    } else {
      flush()
    }
  }

  // Compute, per sentence, the index of its last word. The scan limit for any
  // word is the end of the *next* sentence, so the matcher only ever looks at
  // the current sentence and the one after it.
  const lastSentence = words.length > 0 ? words[words.length - 1].sentenceIndex : 0
  const sentenceLastWord = new Array<number>(lastSentence + 1).fill(0)
  for (let i = 0; i < words.length; i++) {
    sentenceLastWord[words[i].sentenceIndex] = i
  }
  for (const word of words) {
    const nextSentence = Math.min(word.sentenceIndex + 1, lastSentence)
    word.scanLimit = sentenceLastWord[nextSentence]
  }

  return { words, lines }
}

/** How close two normalized words need to be to count as a match. */
function wordsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  // For longer words, allow a small edit distance (mishears, plurals, tense).
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) return true
    if (levenshteinWithin(a, b, 1)) return true
  }
  return false
}

/** Returns true if edit distance between a and b is <= max. */
function levenshteinWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > max) return false
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length] <= max
}

/**
 * Products that follow a prepared script use monotonic local alignment: start
 * at the known position, inspect only the next few tokens, and never search
 * the whole document. A deliberately small window makes a false match cheap
 * (at most a few words) and lets the following spoken words correct course.
 */
const LOCAL_LOOK_AHEAD = 6

/**
 * Deterministically align the complete transcript from the start of the script.
 *
 * Web Speech repeatedly rewrites interim hypotheses. Replaying the complete
 * current transcript means a revision replaces the previous preview instead of
 * being applied on top of it. Each spoken word can only match locally ahead of
 * the last match, so repeated words elsewhere in the script are never searched.
 */
export function alignTranscript(
  scriptWords: ScriptWord[],
  spokenWords: string[],
): number {
  let cursor = 0

  let spokenIndex = 0
  while (spokenIndex < spokenWords.length && cursor < scriptWords.length) {
    const spoken = spokenWords[spokenIndex]
    if (!spoken) {
      spokenIndex++
      continue
    }

    // The expected next word is always safe to accept immediately.
    if (wordsMatch(scriptWords[cursor].clean, spoken)) {
      cursor++
      spokenIndex++
      continue
    }

    // If recognition missed a script word or the speaker skipped one, only
    // jump ahead when the following spoken word confirms the continuation.
    // A repeated standalone word can therefore never move the cursor by itself.
    const nextSpoken = spokenWords[spokenIndex + 1]
    let confirmedEnd = -1
    if (nextSpoken) {
      const limit = Math.min(cursor + LOCAL_LOOK_AHEAD, scriptWords.length - 1)
      for (let j = cursor + 1; j < limit; j++) {
        if (
          wordsMatch(scriptWords[j].clean, spoken) &&
          wordsMatch(scriptWords[j + 1].clean, nextSpoken)
        ) {
          confirmedEnd = j + 2
          break
        }
      }
    }

    if (confirmedEnd !== -1) {
      cursor = confirmedEnd
      spokenIndex += 2
    } else {
      // Treat it as improvisation or a recognition error and hold position.
      spokenIndex++
    }
  }

  return cursor
}

/** Split a raw transcript string into normalized words. */
export function transcriptToWords(transcript: string): string[] {
  return transcript
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0)
}
