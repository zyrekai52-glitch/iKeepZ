import 'package:flutter/painting.dart';

import '../core/utils/json.dart';
import 'preference_values.dart';

/// `users/{uid}/categories/{id}`
class Category {
  const Category({
    required this.id,
    required this.name,
    required this.kind,
    required this.color,
    required this.icon,
    required this.archived,
    required this.createdAt,
  });

  factory Category.fromMap(String id, Map<String, dynamic> map) {
    return Category(
      id: id,
      name: readString(map['name']),
      kind: readChoice(map['kind'], const <String>['income', 'expense', 'both'], 'both'),
      color: readInt(map['color'], 0xFF6B7580),
      icon: readChoice(map['icon'], kCategoryIconKeys, 'other'),
      archived: readBool(map['archived']),
      createdAt: readDate(map['createdAt']),
    );
  }

  final String id;
  final String name;

  /// `income`, `expense` or `both`.
  final String kind;

  /// ARGB value.
  final int color;
  final String icon;
  final bool archived;
  final DateTime? createdAt;

  Color get colorValue => Color(color);

  /// Whether this category can be chosen for a record of [recordKind].
  bool allows(String recordKind) => kind == 'both' || kind == recordKind;
}

/// What the category form produces.
class CategoryDraft {
  const CategoryDraft({required this.name, required this.kind, required this.color, required this.icon});

  final String name;
  final String kind;
  final int color;
  final String icon;
}

/// Colours offered by the category colour picker (ARGB).
const List<int> kCategoryColors = <int>[
  0xFF3F6A85,
  0xFF2F8F4E,
  0xFF4D7C0F,
  0xFFB7791F,
  0xFFC2410C,
  0xFFC53030,
  0xFFBE185D,
  0xFF7C3AED,
  0xFF0E7490,
  0xFFA16207,
  0xFF6B7580,
  0xFF1B2430,
];
