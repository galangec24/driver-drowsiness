/// Owner shown in the copyright notices (same text as the website).
const copyrightOwner = 'Emmanuel Christian';
const productName = 'Guardian Drive';
const firstYear = 2026;

/// "© 2026 Guardian Drive · Emmanuel Christian. All rights reserved." (the year updates itself)
String copyrightNotice([DateTime? now]) {
  final y = (now ?? DateTime.now()).year;
  final years = y > firstYear ? '$firstYear–$y' : '$firstYear';
  return '© $years $productName · $copyrightOwner. All rights reserved.';
}
