import 'package:intl/number_symbols.dart';
import 'package:intl/number_symbols_data.dart';

/// Money is always an integer number of minor units (centavos, cents, ...) plus an ISO-4217 code.
/// There is no floating point in any of the arithmetic below. The behaviour of [parseMajor], [formatPlain]
/// and [computeFee] is pinned by `test_vectors/money.json`, which the backend tests share.

const Map<String, int> kCurrencyExponents = <String, int>{
  'PHP': 2,
  'USD': 2,
  'EUR': 2,
  'GBP': 2,
  'SGD': 2,
  'AUD': 2,
  'CAD': 2,
  'HKD': 2,
  'JPY': 0,
  'KRW': 0,
  'KWD': 3,
  'BHD': 3,
};

const Map<String, String> kCurrencySymbols = <String, String>{
  'PHP': '₱',
  'USD': r'$',
  'EUR': '€',
  'GBP': '£',
  'SGD': r'S$',
  'AUD': r'A$',
  'CAD': r'C$',
  'HKD': r'HK$',
  'JPY': '¥',
  'KRW': '₩',
  'KWD': 'KWD ',
  'BHD': 'BHD ',
};

/// Largest amount (in minor units) the backend accepts in one operation.
const int kMaxMinor = 10000000000000;

bool isSupportedCurrency(String currency) => kCurrencyExponents.containsKey(currency);

int currencyExponent(String currency) => kCurrencyExponents[currency] ?? 2;

String currencySymbol(String currency) => kCurrencySymbols[currency] ?? '$currency ';

/// Result of [parseMajor]: either [minor] or an [error] code.
class MoneyParse {
  const MoneyParse.ok(int this.minor) : error = null;
  const MoneyParse.failed(String this.error) : minor = null;

  final int? minor;

  /// `empty`, `negative`, `invalid`, `too_many_decimals` or `too_large`.
  final String? error;

  bool get isOk => minor != null;
}

bool _isDigits(String text) {
  if (text.isEmpty) return true;
  for (int i = 0; i < text.length; i++) {
    final int unit = text.codeUnitAt(i);
    if (unit < 48 || unit > 57) return false;
  }
  return true;
}

/// Parses user input such as "1,234.50" into minor units.
MoneyParse parseMajor(String input, String currency) {
  final int exponent = currencyExponent(currency);
  final String text = input.trim().replaceAll(',', '');
  if (text.isEmpty) return const MoneyParse.failed('empty');
  final bool negative = text.startsWith('-');
  final String body = negative ? text.substring(1) : text;
  final List<String> parts = body.split('.');
  if (parts.length > 2) return const MoneyParse.failed('invalid');
  final String whole = parts[0];
  final String fraction = parts.length == 2 ? parts[1] : '';
  if (!_isDigits(whole) || !_isDigits(fraction) || (whole.isEmpty && fraction.isEmpty)) {
    return const MoneyParse.failed('invalid');
  }
  if (negative) return const MoneyParse.failed('negative');
  if (fraction.length > exponent) return const MoneyParse.failed('too_many_decimals');
  final String digits = (whole.isEmpty ? '0' : whole) + fraction.padRight(exponent, '0');
  final String trimmed = digits.replaceFirst(RegExp(r'^0+(?=\d)'), '');
  if (trimmed.length > 14) return const MoneyParse.failed('too_large');
  final int minor = int.parse(trimmed);
  if (minor > kMaxMinor) return const MoneyParse.failed('too_large');
  return MoneyParse.ok(minor);
}

/// 123450 PHP -> "1234.50" (no grouping, no symbol).
String formatPlain(int minor, String currency) {
  final int exponent = currencyExponent(currency);
  final bool negative = minor < 0;
  final String digits = (negative ? -minor : minor).toString().padLeft(exponent + 1, '0');
  final String whole = digits.substring(0, digits.length - exponent);
  final String fraction = exponent > 0 ? digits.substring(digits.length - exponent) : '';
  return '${negative ? '-' : ''}$whole${exponent > 0 ? '.$fraction' : ''}';
}

NumberSymbols? _symbolsFor(String locale) {
  final NumberSymbols? exact = numberFormatSymbols[locale];
  if (exact != null) return exact;
  final int cut = locale.indexOf('_');
  if (cut > 0) return numberFormatSymbols[locale.substring(0, cut)];
  return null;
}

String _group(String digits, String separator) {
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(separator);
    out.write(digits[i]);
  }
  return out.toString();
}

/// Formats [minor] for display: "₱1,234.50", "-₱20.00", or with [showCode] "PHP 1,234.50".
String formatMoney(
  int minor,
  String currency, {
  String locale = 'en_PH',
  bool showCode = false,
  bool forceSign = false,
}) {
  final NumberSymbols? symbols = _symbolsFor(locale);
  final String groupSeparator = symbols == null ? ',' : symbols.GROUP_SEP;
  final String decimalSeparator = symbols == null ? '.' : symbols.DECIMAL_SEP;
  final String plain = formatPlain(minor < 0 ? -minor : minor, currency);
  final List<String> parts = plain.split('.');
  final String whole = _group(parts[0], groupSeparator);
  final String number = parts.length == 2 ? '$whole$decimalSeparator${parts[1]}' : whole;
  final String sign = minor < 0 ? '-' : (forceSign && minor > 0 ? '+' : '');
  final String prefix = showCode ? '$currency ' : currencySymbol(currency);
  return '$sign$prefix$number';
}

/// A short form for chart axes: 1.2K, 3.4M. Uses doubles, so it is for display only.
String formatCompact(int minor, String currency) {
  final int exponent = currencyExponent(currency);
  double major = minor.toDouble();
  for (int i = 0; i < exponent; i++) {
    major /= 10;
  }
  final double abs = major < 0 ? -major : major;
  final String sign = major < 0 ? '-' : '';
  if (abs >= 1000000000) return '$sign${_trim(abs / 1000000000)}B';
  if (abs >= 1000000) return '$sign${_trim(abs / 1000000)}M';
  if (abs >= 1000) return '$sign${_trim(abs / 1000)}K';
  return '$sign${_trim(abs)}';
}

String _trim(double value) {
  final String text = value.toStringAsFixed(1);
  return text.endsWith('.0') ? text.substring(0, text.length - 2) : text;
}

/// fee = round_half_up(amount * bps / 10000) + fixed. Never negative.
int computeFee(int amountMinor, {int bps = 0, int fixedMinor = 0}) {
  if (amountMinor < 0) throw ArgumentError.value(amountMinor, 'amountMinor', 'must not be negative');
  final int percentage = (amountMinor * bps + 5000) ~/ 10000;
  return percentage + fixedMinor;
}

/// Validation message for an amount typed by the user, or null when it is acceptable.
String? validateAmountInput(
  String input,
  String currency, {
  int? minMinor,
  int? maxMinor,
  bool allowZero = false,
}) {
  final MoneyParse parsed = parseMajor(input, currency);
  final int exponent = currencyExponent(currency);
  switch (parsed.error) {
    case 'empty':
      return 'Enter an amount.';
    case 'negative':
      return 'The amount cannot be negative.';
    case 'too_many_decimals':
      return exponent == 0 ? 'Use a whole amount.' : 'Use at most $exponent decimal places.';
    case 'too_large':
      return 'That amount is too large.';
    case 'invalid':
      return 'Enter a valid amount, for example 1,250.50.';
    default:
      break;
  }
  final int minor = parsed.minor ?? 0;
  if (minor == 0 && !allowZero) return 'The amount must be more than zero.';
  if (minMinor != null && minor < minMinor) {
    return 'The minimum is ${formatMoney(minMinor, currency)}.';
  }
  if (maxMinor != null && minor > maxMinor) {
    return 'The maximum is ${formatMoney(maxMinor, currency)}.';
  }
  return null;
}
