#ifndef FUNCTIONS_CHARGE_FULL_PROP_H
#define FUNCTIONS_CHARGE_FULL_PROP_H

#include "svf.h"
#include "../common/charge_state.h"

// Style function: 0 when not full, 32768 when full.
// Just wraps the global g_charge_full set by MyFettProp.
class ChargeFullPropSVF {
public:
  void run(BladeBase* blade) {}

  int calculate(BladeBase* blade) {
    return g_charge_full ? 32768 : 0;
  }

  int getInteger(int led) {
    return calculate(nullptr);
  }
};

using ChargeFullPropF = SingleValueAdapter<ChargeFullPropSVF>;

#endif
