// Compile-time hint messages shown during long compiles.
// One message per line — edit freely. Order is preserved (not random).
// First message appears at 60 seconds; each subsequent message every ~25 seconds.
// Remove a line to skip it. Add lines to extend the sequence.
// At ~25s per message, 35 messages covers roughly 15 minutes of compile time.
const COMPILE_HINTS = [

  // ~ 1 min
  "Hang in there, this can sometimes take a while\u2026",
  "Compiling ProffieOS — large configs take longer to process.",

  // ~ 2 min
  "Building blade styles and effects\u2026",
  "Optimizing memory usage for your config\u2026",

  // ~ 3 min
  "Your blade styles are being resolved into optimized machine code.",
  "Good things take time\u2026 especially lightsabers.",

  // ~ 4 min
  "The compiler is resolving template parameters across your entire config.",
  "No errors so far — that\u2019s a good sign.",

  // ~ 5 min
  "ProffieOS uses extensive C++ templates — complex configs compile slowly by design.",
  "Each preset is being individually optimized.",
  "Calibrating the Force\u2026",

  // ~ 6 min
  "The STM32 toolchain is carefully arranging memory layout.",
  "Large style stacks take longer — the result is worth it.",

  // ~ 7 min
  "Working through complex sections of your build\u2026",
  "Your saber is being brought to life, one instruction at a time.",
  "ProffieOS links together hundreds of template classes.",

  // ~ 8 min
  "No news is good news — still compiling cleanly.",
  "Blade effects are being compiled into efficient embedded code.",

  // ~ 9 min
  "The compiler is inlining and optimizing your style functions.",
  "Still going\u2026 ProffieOS is thorough.",
  "This is a good time to stretch.",

  // ~ 10 min
  "Complex configs take time — this is completely normal.",
  "The more effects in your config, the more work the compiler does.",

  // ~ 11 min
  "The toolchain is making sure everything fits in memory.",
  "ProffieOS is a sophisticated system — compiling it takes time.",
  "Take a breath. This is one of the longer ones.",

  // ~ 12 min
  "Almost every builder has waited through a compile like this.",
  "The compiler is working hard behind the scenes.",

  // ~ 13 min
  "Memory optimization pass\u2026 fitting your config into flash.",
  "Still going\u2026 larger configs can take 10\u201315 minutes.",
  "Linking\u2026 this is usually one of the final steps.",

  // ~ 14 min
  "Every blade style, sound, and preset is being wired together.",
  "The wait is part of the craft. Your config will be worth it.",

  // ~ 15 min
  "Thanks for your patience\u2026 almost there.",
  "Finalizing build\u2026 just about done.",

];
