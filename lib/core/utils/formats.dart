import 'package:intl/intl.dart';

/// Locale-aware date formatting used across the app. [localeKey] is one of `en_PH`, `en_US`, `en_GB`, `fil_PH`.
class AppFormats {
  AppFormats(this.localeKey)
      : _date = DateFormat.yMMMd(localeKey),
        _dateTime = DateFormat.yMMMd(localeKey).add_jm(),
        _monthYear = DateFormat.yMMM(localeKey),
        _monthLong = DateFormat.yMMMM(localeKey),
        _shortMonth = DateFormat.MMM(localeKey),
        _dayMonth = DateFormat.MMMd(localeKey),
        _time = DateFormat.jm(localeKey);

  final String localeKey;
  final DateFormat _date;
  final DateFormat _dateTime;
  final DateFormat _monthYear;
  final DateFormat _monthLong;
  final DateFormat _shortMonth;
  final DateFormat _dayMonth;
  final DateFormat _time;

  String date(DateTime value) => _date.format(value.toLocal());
  String dateTime(DateTime value) => _dateTime.format(value.toLocal());
  String monthYear(DateTime value) => _monthYear.format(value);
  String monthYearLong(DateTime value) => _monthLong.format(value);
  String shortMonth(DateTime value) => _shortMonth.format(value);
  String dayMonth(DateTime value) => _dayMonth.format(value);
  String time(DateTime value) => _time.format(value.toLocal());

  /// "Today", "Yesterday" or the date.
  String relativeDay(DateTime value, {DateTime? now}) {
    final DateTime reference = now ?? DateTime.now();
    final DateTime day = DateTime(value.year, value.month, value.day);
    final DateTime today = DateTime(reference.year, reference.month, reference.day);
    final int difference = today.difference(day).inDays;
    if (difference == 0) return 'Today';
    if (difference == 1) return 'Yesterday';
    return date(value);
  }
}

/// ISO date (2026-10-29) used in CSV exports and file names. Always in the local time zone.
String isoDate(DateTime value) {
  final DateTime local = value.toLocal();
  final String month = local.month.toString().padLeft(2, '0');
  final String day = local.day.toString().padLeft(2, '0');
  return '${local.year}-$month-$day';
}

/// 20261029-1530 for file names.
String fileStamp(DateTime value) {
  final DateTime local = value.toLocal();
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${isoDate(local).replaceAll('-', '')}-$hour$minute';
}

DateTime startOfDay(DateTime value) => DateTime(value.year, value.month, value.day);

DateTime startOfMonth(DateTime value) => DateTime(value.year, value.month);

DateTime addMonths(DateTime value, int months) => DateTime(value.year, value.month + months);
