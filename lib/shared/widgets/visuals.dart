import 'package:flutter/material.dart';

import '../../models/category.dart';
import '../../theme/tokens.dart';

const Map<String, IconData> kCategoryIcons = <String, IconData>{
  'salary': Icons.payments_outlined,
  'business': Icons.business_center_outlined,
  'gift': Icons.card_giftcard_outlined,
  'wallet': Icons.account_balance_wallet_outlined,
  'savings': Icons.savings_outlined,
  'investment': Icons.trending_up,
  'food': Icons.restaurant_outlined,
  'groceries': Icons.shopping_basket_outlined,
  'coffee': Icons.local_cafe_outlined,
  'transport': Icons.directions_bus_outlined,
  'travel': Icons.flight_outlined,
  'bills': Icons.receipt_long_outlined,
  'home': Icons.home_outlined,
  'shopping': Icons.shopping_bag_outlined,
  'health': Icons.favorite_border,
  'fitness': Icons.fitness_center_outlined,
  'education': Icons.school_outlined,
  'entertainment': Icons.movie_outlined,
  'subscription': Icons.subscriptions_outlined,
  'insurance': Icons.shield_outlined,
  'tax': Icons.account_balance_outlined,
  'kids': Icons.child_care_outlined,
  'pets': Icons.pets_outlined,
  'other': Icons.category_outlined,
};

IconData categoryIconFor(String key) => kCategoryIcons[key] ?? Icons.category_outlined;

/// A rounded square in the category colour with its icon.
class CategoryBadge extends StatelessWidget {
  const CategoryBadge({super.key, required this.color, required this.icon, this.size = 38});

  final Color color;
  final String icon;
  final double size;

  factory CategoryBadge.of(Category category, {double size = 38}) {
    return CategoryBadge(color: category.colorValue, icon: category.icon, size: size);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(size / 3.4),
      ),
      child: Icon(categoryIconFor(icon), color: color, size: size * 0.52),
    );
  }
}

/// Profile picture or initials.
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, required this.initials, this.photoUrl, this.size = 40});

  final String initials;
  final String? photoUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final Widget fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: tokens.selected, shape: BoxShape.circle),
      child: Text(initials, style: monoStyle(size: size * 0.38, weight: FontWeight.w700, color: tokens.primary)),
    );
    final String? url = photoUrl;
    if (url == null || url.isEmpty) return fallback;
    return ClipOval(
      child: Image.network(
        url,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (BuildContext context, Object error, StackTrace? stackTrace) => fallback,
        loadingBuilder: (BuildContext context, Widget child, ImageChunkEvent? progress) => progress == null ? child : fallback,
      ),
    );
  }
}

/// The iKeepZ mark (bundled asset) at [size].
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 32});

  final double size;

  @override
  Widget build(BuildContext context) {
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      dark ? 'assets/branding/ikeepz_mark_dark.png' : 'assets/branding/ikeepz_mark.png',
      width: size,
      height: size,
      semanticLabel: 'iKeepZ',
    );
  }
}

/// A small coloured dot (legends, category colours).
class ColorDot extends StatelessWidget {
  const ColorDot(this.color, {super.key, this.size = 10});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(width: size, height: size, decoration: BoxDecoration(color: color, shape: BoxShape.circle));
  }
}
