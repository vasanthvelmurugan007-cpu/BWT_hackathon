class PhishingResult {
  final double score;
  final String level;
  final List<String> reasons;
  final String explanation;
  final String explanationHi;
  final bool aiUsed;

  PhishingResult({
    required this.score,
    required this.level,
    required this.reasons,
    required this.explanation,
    required this.explanationHi,
    required this.aiUsed,
  });
}
