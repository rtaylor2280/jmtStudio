/**
 * effect-keywords.js
 * ProffieOS style function → effect display name mappings.
 *
 * JMT Studio scans `using Name = ...;` code against these patterns in
 * real-time to show which effects a style supports. Effects are never
 * written back to the file — this is purely a display/informational feature.
 *
 * Pattern rules:
 *   - Each pattern is matched as /\bPATTERN/ against the raw using-code string
 *   - The \b prefix is added automatically; do NOT add it here
 *   - A prefix pattern (no trailing \b) matches all variants:
 *     e.g. "BlastL" matches "BlastL" and catches nothing extra since it ends at L
 *     e.g. "ResponsiveBlast" catches ResponsiveBlastL, ResponsiveBlastWaveL, etc.
 *   - Multiple patterns mapping to the same effect are de-duplicated automatically
 *
 * Add entries here to recognize custom ProffieOS functions or community layers.
 * Each entry: { pattern: String, effect: String }
 */
window.PROFFIE_EFFECT_KEYWORDS = [

  // ── Ignition / Retraction ────────────────────────────────────────────
  { pattern: 'InOutHelper',         effect: 'In/Out'           }, // InOutHelper, InOutHelperL, InOutHelperTD
  { pattern: 'InOutTr',             effect: 'In/Out'           }, // InOutTr, InOutTrL
  { pattern: 'InOutSparkTip',       effect: 'In/Out'           }, // InOutSparkTip, InOutSparkTipX
  { pattern: 'OnSpark',             effect: 'In/Out'           }, // OnSpark, OnSparkL
  { pattern: 'IgnitionDelay',       effect: 'In/Out'           }, // IgnitionDelay, IgnitionDelayX
  { pattern: 'RetractionDelay',     effect: 'In/Out'           }, // RetractionDelay, RetractionDelayX

  // ── Boot ─────────────────────────────────────────────────────────────
  { pattern: 'EFFECT_BOOT',         effect: 'Boot'             },
  { pattern: 'BootL',               effect: 'Boot'             },

  // ── Preon ────────────────────────────────────────────────────────────
  { pattern: 'EFFECT_PREON',        effect: 'Preon'            },
  { pattern: 'PreonL',              effect: 'Preon'            },

  // ── PostOff ──────────────────────────────────────────────────────────
  { pattern: 'EFFECT_POSTOFF',      effect: 'PostOff'          },
  { pattern: 'PostoffL',            effect: 'PostOff'          },

  // ── Lockup ───────────────────────────────────────────────────────────
  { pattern: 'LockupL',             effect: 'Lockup'           },
  { pattern: 'LockupTr',            effect: 'Lockup'           }, // LockupTr, LockupTrL
  { pattern: 'ResponsiveLockup',    effect: 'Lockup'           }, // ResponsiveLockupL

  // ── Lightning Block ──────────────────────────────────────────────────
  { pattern: 'LockupType::LIGHTNING_BLOCK', effect: 'Lightning Block' },
  { pattern: 'LOCKUP_LIGHTNING_BLOCK',      effect: 'Lightning Block' }, // SaberBase::LOCKUP_LIGHTNING_BLOCK
  { pattern: 'ResponsiveLightningBlock',    effect: 'Lightning Block' }, // ResponsiveLightningBlockL

  // ── Drag ─────────────────────────────────────────────────────────────
  { pattern: 'LockupType::DRAG',    effect: 'Drag'             },
  { pattern: 'LOCKUP_DRAG',         effect: 'Drag'             }, // LockupTrL<..., LOCKUP_DRAG>
  { pattern: 'ResponsiveDrag',      effect: 'Drag'             }, // ResponsiveDragL

  // ── Melt ─────────────────────────────────────────────────────────────
  { pattern: 'LockupType::MELT',    effect: 'Melt'             },
  { pattern: 'LOCKUP_MELT',         effect: 'Melt'             }, // LockupTrL<..., LOCKUP_MELT>
  { pattern: 'ResponsiveMelt',      effect: 'Melt'             }, // ResponsiveMeltL

  // ── Stab ─────────────────────────────────────────────────────────────
  { pattern: 'ResponsiveStab',      effect: 'Stab'             }, // ResponsiveStabL
  { pattern: 'StabL',               effect: 'Stab'             },
  { pattern: 'EFFECT_STAB',         effect: 'Stab'             },

  // ── Blast ────────────────────────────────────────────────────────────
  { pattern: 'BlastL',              effect: 'Blast'            },
  { pattern: 'BlastFadeout',        effect: 'Blast'            }, // BlastFadeout, BlastFadeoutL
  { pattern: 'OriginalBlast',       effect: 'Blast'            }, // OriginalBlast, OriginalBlastL
  { pattern: 'ResponsiveBlast',     effect: 'Blast'            }, // ResponsiveBlastL/WaveL/FadeL
  { pattern: 'EFFECT_BLAST',        effect: 'Blast'            }, // TransitionEffectL<..., EFFECT_BLAST>

  // ── Clash ────────────────────────────────────────────────────────────
  { pattern: 'SimpleClash',         effect: 'Clash'            }, // SimpleClash, SimpleClashL
  { pattern: 'LocalizedClash',      effect: 'Clash'            }, // LocalizedClash, LocalizedClashL
  { pattern: 'ResponsiveClash',     effect: 'Clash'            }, // ResponsiveClashL
  { pattern: 'EFFECT_CLASH',        effect: 'Clash'            }, // TransitionEffectL<..., EFFECT_CLASH>

  // ── Force Push ───────────────────────────────────────────────────────
  { pattern: 'EFFECT_FORCE',        effect: 'Force'            },
  { pattern: 'ForceL',              effect: 'Force'            },

  // ── Color Change ─────────────────────────────────────────────────────
  { pattern: 'ColorChange',         effect: 'Color Change'     }, // ColorChange, ColorChangeL

  // ── Audio-reactive ───────────────────────────────────────────────────
  { pattern: 'AudioFlicker',        effect: 'AudioFlicker'     }, // AudioFlicker, AudioFlickerL

  // ── Battery ──────────────────────────────────────────────────────────
  { pattern: 'BatteryLevel',        effect: 'Battery'          },

  // ── PowerSave ────────────────────────────────────────────────────────
  { pattern: 'EFFECT_POWERSAVE',    effect: 'PowerSave'        }, // EffectSequence<EFFECT_POWERSAVE, ...>

  // ── Volume ───────────────────────────────────────────────────────────
  { pattern: 'EFFECT_VOLUME_LEVEL', effect: 'Volume'           }, // TransitionEffectL<..., EFFECT_VOLUME_LEVEL>

];
