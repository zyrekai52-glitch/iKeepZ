import 'package:flutter/material.dart';

/// One destination of the sidebar, the phone drawer and the command palette.
@immutable
class NavItem {
  const NavItem({
    required this.path,
    required this.label,
    required this.icon,
    required this.group,
    this.keywords = const <String>[],
  });

  final String path;
  final String label;
  final IconData icon;
  final String group;

  /// Extra words the command palette matches (for example "balance" finds the E-Wallet).
  final List<String> keywords;

  bool matches(String location) => location == path || location.startsWith('$path/');
}

/// The twelve sections of the app, in sidebar order.
const List<NavItem> kNavItems = <NavItem>[
  NavItem(path: '/dashboard', label: 'Dashboard', icon: Icons.dashboard_outlined, group: 'Main', keywords: <String>['home', 'overview', 'summary']),
  NavItem(path: '/analytics', label: 'Analytics', icon: Icons.insights_outlined, group: 'Main', keywords: <String>['charts', 'trends', 'spending']),
  NavItem(path: '/records', label: 'Records', icon: Icons.receipt_long_outlined, group: 'Main', keywords: <String>['transactions', 'income', 'expenses', 'entries']),
  NavItem(path: '/categories', label: 'Categories', icon: Icons.sell_outlined, group: 'Main', keywords: <String>['labels', 'tags']),
  NavItem(path: '/reports', label: 'Reports', icon: Icons.assessment_outlined, group: 'Main', keywords: <String>['export', 'csv', 'pdf', 'download']),
  NavItem(path: '/wallet', label: 'E-Wallet', icon: Icons.account_balance_wallet_outlined, group: 'Wallet', keywords: <String>['balance', 'deposit', 'withdraw', 'transfer', 'send', 'money']),
  NavItem(path: '/notifications', label: 'Notifications', icon: Icons.notifications_none, group: 'Account', keywords: <String>['alerts', 'inbox']),
  NavItem(path: '/profile', label: 'Profile', icon: Icons.person_outline, group: 'Account', keywords: <String>['name', 'photo', 'avatar', 'account']),
  NavItem(path: '/security', label: 'Security', icon: Icons.shield_outlined, group: 'Account', keywords: <String>['password', 'pin', 'sessions', 'lock']),
  NavItem(path: '/settings', label: 'Settings', icon: Icons.settings_outlined, group: 'Account', keywords: <String>['theme', 'currency', 'language', 'appearance']),
  NavItem(path: '/help', label: 'Help & Support', icon: Icons.help_outline, group: 'More', keywords: <String>['faq', 'contact', 'support']),
  NavItem(path: '/about', label: 'About', icon: Icons.info_outline, group: 'More', keywords: <String>['version', 'licenses', 'privacy']),
];

/// Only shown to accounts that carry the `admin` claim.
const NavItem kAdminNavItem = NavItem(
  path: '/admin',
  label: 'Wallet admin',
  icon: Icons.admin_panel_settings_outlined,
  group: 'Admin',
  keywords: <String>['withdrawals', 'reconcile', 'review', 'payout'],
);

/// The four destinations on the phone's bottom bar; the fifth entry opens the full menu.
const List<String> kBottomBarPaths = <String>['/dashboard', '/records', '/wallet', '/analytics'];

NavItem? navItemFor(String location, {bool includeAdmin = true}) {
  for (final NavItem item in kNavItems) {
    if (item.matches(location)) return item;
  }
  if (includeAdmin && kAdminNavItem.matches(location)) return kAdminNavItem;
  return null;
}
