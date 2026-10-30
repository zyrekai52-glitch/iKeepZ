import '../core/utils/json.dart';

const String kKindIncome = 'income';
const String kKindExpense = 'expense';

/// `users/{uid}/records/{id}`: one income or expense entry.
class MoneyRecord {
  const MoneyRecord({
    required this.id,
    required this.kind,
    required this.title,
    required this.amountMinor,
    required this.currency,
    required this.categoryId,
    required this.categoryName,
    required this.date,
    required this.notes,
    required this.tags,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MoneyRecord.fromMap(String id, Map<String, dynamic> map) {
    return MoneyRecord(
      id: id,
      kind: readChoice(map['kind'], const <String>[kKindIncome, kKindExpense], kKindExpense),
      title: readString(map['title']),
      amountMinor: readInt(map['amountMinor']),
      currency: readString(map['currency'], 'PHP'),
      categoryId: readStringOrNull(map['categoryId']),
      categoryName: readString(map['categoryName']),
      date: readDate(map['date']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      notes: readString(map['notes']),
      tags: readStringList(map['tags']),
      createdAt: readDate(map['createdAt']),
      updatedAt: readDate(map['updatedAt']),
    );
  }

  final String id;
  final String kind;
  final String title;
  final int amountMinor;
  final String currency;
  final String? categoryId;
  final String categoryName;
  final DateTime date;
  final String notes;
  final List<String> tags;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isIncome => kind == kKindIncome;

  /// Positive for income, negative for expenses.
  int get signedMinor => isIncome ? amountMinor : -amountMinor;

  /// Key used to group records of the same category: the id when there is one, otherwise the stored name.
  String get groupKey => categoryId ?? 'name:$categoryName';
}

/// What the record form produces; the repository adds the server timestamps.
class RecordDraft {
  const RecordDraft({
    required this.kind,
    required this.title,
    required this.amountMinor,
    required this.currency,
    required this.categoryId,
    required this.categoryName,
    required this.date,
    required this.notes,
    required this.tags,
  });

  final String kind;
  final String title;
  final int amountMinor;
  final String currency;
  final String? categoryId;
  final String categoryName;
  final DateTime date;
  final String notes;
  final List<String> tags;
}

/// Tags are trimmed, de-duplicated (case-insensitively), limited to 30 characters each and 10 in total.
List<String> normalizeTags(Iterable<String> input) {
  final List<String> out = <String>[];
  final Set<String> seen = <String>{};
  for (final String raw in input) {
    String tag = raw.trim();
    if (tag.startsWith('#')) tag = tag.substring(1).trim();
    if (tag.isEmpty) continue;
    if (tag.length > 30) tag = tag.substring(0, 30);
    if (seen.add(tag.toLowerCase())) out.add(tag);
    if (out.length >= 10) break;
  }
  return out;
}

/// Splits "food, lunch #work" into tags.
List<String> parseTagInput(String text) {
  return normalizeTags(text.split(RegExp(r'[,;\n]')).expand((String part) => part.split(RegExp(r'\s+#'))));
}
