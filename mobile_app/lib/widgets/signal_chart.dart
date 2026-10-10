import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../config/theme.dart';

/// Area chart for EAR / HR / fusion score with an optional dashed threshold line.
class SignalChart extends StatelessWidget {
  const SignalChart({
    super.key,
    required this.label,
    required this.values,
    required this.color,
    this.threshold,
    this.minY,
    this.maxY,
    this.unit = '',
    this.digits = 3,
    this.height = 120,
  });

  final String label;
  final List<double?> values;
  final Color color;
  final double? threshold;
  final double? minY;
  final double? maxY;
  final String unit;
  final int digits;
  final double height;

  @override
  Widget build(BuildContext context) {
    final spots = <FlSpot>[
      for (var i = 0; i < values.length; i++)
        if (values[i] != null) FlSpot(i.toDouble(), values[i]!),
    ];
    final last = spots.isEmpty ? null : spots.last.y;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                color: AppColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1,
              ),
            ),
            Text(
              last == null
                  ? '—'
                  : '${unit.isEmpty ? last.toStringAsFixed(digits) : last.round()}$unit',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          height: height,
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          padding: const EdgeInsets.all(6),
          child: spots.length < 2
              ? const Center(
                  child: Text(
                    'Waiting for sensor data…',
                    style: TextStyle(color: AppColors.muted, fontSize: 12),
                  ),
                )
              : LineChart(
                  LineChartData(
                    minY: minY,
                    maxY: maxY,
                    gridData: const FlGridData(show: false),
                    titlesData: const FlTitlesData(show: false),
                    borderData: FlBorderData(show: false),
                    lineTouchData: const LineTouchData(enabled: false),
                    extraLinesData: threshold == null
                        ? null
                        : ExtraLinesData(
                            horizontalLines: [
                              HorizontalLine(
                                y: threshold!,
                                color: AppColors.danger.withValues(alpha: 0.7),
                                strokeWidth: 1.5,
                                dashArray: const [6, 6],
                              ),
                            ],
                          ),
                    lineBarsData: [
                      LineChartBarData(
                        spots: spots,
                        isCurved: true,
                        curveSmoothness: 0.2,
                        color: color,
                        barWidth: 2.5,
                        dotData: const FlDotData(show: false),
                        shadow: Shadow(color: color, blurRadius: 6),
                        belowBarData: BarAreaData(
                          show: true,
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              color.withValues(alpha: 0.35),
                              color.withValues(alpha: 0),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  duration: Duration.zero,
                ),
        ),
      ],
    );
  }
}
