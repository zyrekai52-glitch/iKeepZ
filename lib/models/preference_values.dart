/// The fixed value sets shared with the Firestore rules (`backend/firestore.rules`).
/// `backend/rules-tests/parity.test.js` and `test/parity_test.dart` fail if these drift apart.

const List<String> kThemeModes = <String>['system', 'light', 'dark'];

const List<String> kAccentKeys = <String>['slate', 'sage', 'clay', 'moss', 'stone', 'dusk'];

const List<String> kFontScaleKeys = <String>['small', 'medium', 'large'];

const List<String> kLocaleKeys = <String>['en_PH', 'en_US', 'en_GB', 'fil_PH'];

const List<String> kCategoryIconKeys = <String>[
  'salary',
  'business',
  'gift',
  'wallet',
  'savings',
  'investment',
  'food',
  'groceries',
  'coffee',
  'transport',
  'travel',
  'bills',
  'home',
  'shopping',
  'health',
  'fitness',
  'education',
  'entertainment',
  'subscription',
  'insurance',
  'tax',
  'kids',
  'pets',
  'other',
];

const Map<String, String> kLocaleLabels = <String, String>{
  'en_PH': 'English (Philippines)',
  'en_US': 'English (United States)',
  'en_GB': 'English (United Kingdom)',
  'fil_PH': 'Filipino (Philippines)',
};

const Map<String, String> kAccentLabels = <String, String>{
  'slate': 'Slate',
  'sage': 'Sage',
  'clay': 'Clay',
  'moss': 'Moss',
  'stone': 'Stone',
  'dusk': 'Dusk',
};

const Map<String, String> kFontScaleLabels = <String, String>{
  'small': 'Small',
  'medium': 'Medium',
  'large': 'Large',
};

const Map<String, String> kThemeLabels = <String, String>{
  'system': 'System',
  'light': 'Light',
  'dark': 'Dark',
};

/// Currencies that can be chosen for display and records. The wallet currency is fixed when the account is created.
const List<String> kDisplayCurrencies = <String>['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD', 'HKD', 'JPY', 'KRW'];

/// Choices for the auto-lock setting; 0 means "never".
const List<int> kAutoLockChoices = <int>[0, 1, 5, 15, 30, 60];
