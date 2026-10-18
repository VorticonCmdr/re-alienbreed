// The manual-lookup code check of the unpatched program (ALIEN.EX_ 1000:03C1-0493). The supplied ALIEN.EXE jumps over
// the comparison at 0452, so the port only asks when the page option is on. The table (cs:049A, 64 records of six
// bytes: row digits, column, the three code characters) and the prompt (cs:061A) are read from the user's executable.
const CODE = 0x1000, TABLE = 0x49a, PROMPT = 0x61a;

// One table entry; 03D5-0415 write its table letter, row and column into the prompt text.
export function passcodeEntry(exe, index) {
  const at = TABLE + 6 * (index & 0x3f), char = k => String.fromCharCode(exe.u8(CODE, at + k));
  return { table: String.fromCharCode(0x41 + ((index & 0x3f) >> 4)), row: char(0) + char(1), column: char(2), code: char(3) + char(4) + char(5) };
}
// The '$'-terminated prompt as INT 21h/09 prints it, with the entry's characters at cs:0687, 068D/068E and 0697.
export function passcodePrompt(exe, entry) {
  const patch = { 0x687: entry.table, 0x68d: entry.row[0], 0x68e: entry.row[1], 0x697: entry.column };
  let text = ''; for (let p = PROMPT; exe.u8(CODE, p) !== 0x24; p++) { const c = exe.u8(CODE, p); if (c !== 13) text += patch[p] ?? String.fromCharCode(c); }
  return text;
}

// `context`: { exe, show(text), pick() (one step of the game's RNG, seeded from the clock at start-up: [B038]),
// takeChar() (the next typed character or null), log(entry) }. One yield per retrace. Returns true when the code
// matches; after the third wrong code the original jumps to the program exit (7B0F) and this returns false.
export function* passcode(context) {
  const { exe } = context;
  for (let i = 0; i < 100; i++) yield; // 03C1: 100 retraces before the first prompt
  for (let tries = 3; ;) { // cs:0496
    const entry = passcodeEntry(exe, context.pick() & 0x3f), prompt = passcodePrompt(exe, entry);
    context.log(entry); context.show(prompt);
    let typed = ''; // 0432: three INT 21h/01 reads, echoed; any character counts, including Enter
    while (typed.length < 3) { const c = context.takeChar(); if (c !== null) { typed += c; context.show(prompt + [...typed].filter(ch => ch >= ' ').join('')); } else yield; }
    if (typed === entry.code) return true; // 0452-0474: three byte compares, case-sensitive
    for (let i = 0; i < 50; i++) yield; // 0478
    if (--tries <= 0) return false;
  }
}
