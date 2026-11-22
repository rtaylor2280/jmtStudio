// Date-only strings in LOCAL time. ([B-339])
//
// toISOString().slice(0, 10) is the UTC date, and after 6 PM Mountain that is
// TOMORROW - an evening import was "acquired" on a day that had not happened
// yet. Every date-only stamp a user can read derives from local date parts
// instead. The renderer's display formatter already parses date-only strings
// as local midnight ("s + 'T00:00:00'"), so a local stamp round-trips exactly.
function localDateString(input) {
  const d = input instanceof Date ? input : (input != null ? new Date(input) : new Date());
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { localDateString };
