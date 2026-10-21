import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/links.dart';
import '../config/theme.dart';
import '../widgets/glass_card.dart';
import '../widgets/mesh_background.dart';

class _AboutFrame extends StatelessWidget {
  const _AboutFrame({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    extendBodyBehindAppBar: true,
    body: MeshBackground(
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            for (final c in children) ...[c, const SizedBox(height: 14)],
          ],
        ),
      ),
    ),
  );
}

Widget _h(String t) => Text(
  t,
  style: const TextStyle(
    color: Colors.white,
    fontSize: 18,
    fontWeight: FontWeight.w700,
  ),
);

Widget _p(String t) => Padding(
  padding: const EdgeInsets.only(top: 6),
  child: Text(t, style: const TextStyle(color: AppColors.muted, height: 1.4)),
);

Widget _point(IconData icon, String title, String text) => Padding(
  padding: const EdgeInsets.only(top: 12),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: AppColors.glow, size: 20),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
            Text(text, style: const TextStyle(color: AppColors.muted)),
          ],
        ),
      ),
    ],
  ),
);

/// About Guardian Drive (same story as the website's /about).
class AboutAppScreen extends StatelessWidget {
  const AboutAppScreen({super.key});

  @override
  Widget build(BuildContext context) => _AboutFrame(
    title: 'About Guardian Drive',
    children: [
      GlassCard(
        interactive: false,
        child: Column(
          children: [
            Image.asset('assets/icon.png', width: 72, height: 72),
            const SizedBox(height: 10),
            const Text(
              "Know they're awake at the wheel.",
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
            _p(
              'Guardian Drive watches for drowsy and distracted driving in real '
              'time and tells the driver and their family the moment it matters.',
            ),
          ],
        ),
      ),
      GlassCard(
        interactive: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _h('How it works'),
            _point(
              Icons.videocam_rounded,
              'Watches, quietly',
              'A small camera in the car looks at the eyes and head. Nothing is recorded as video.',
            ),
            _point(
              Icons.person_search_rounded,
              'Learns what is normal',
              'It learns how this driver normally blinks, so small eyes or glasses do not cause false alarms.',
            ),
            _point(
              Icons.warning_amber_rounded,
              'Spots the warning signs',
              'Eyes closing too long, slow blinks, yawning, nodding off or looking away from the road.',
            ),
            _point(
              Icons.notifications_active_rounded,
              'Speaks up and tells you',
              'A calm voice asks the driver to rest, and you get an alert with the place and a photo.',
            ),
          ],
        ),
      ),
      GlassCard(
        interactive: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _h('What you get'),
            _point(
              Icons.visibility_rounded,
              'Real-time monitoring',
              'Each driver live: awake, tired or drowsy.',
            ),
            _point(
              Icons.place_rounded,
              'Location & history',
              'Where they are, every reading by the minute and the km driven.',
            ),
            _point(
              Icons.record_voice_over_rounded,
              'Messages in any language',
              'English, Tagalog, Bisaya, Taglish, Chinese and more, read aloud in the car.',
            ),
            _point(
              Icons.lock_rounded,
              'Private by design',
              'Only you see your drivers; deleting one needs a code sent to your e-mail.',
            ),
            const SizedBox(height: 10),
            _p(
              'Guardian Drive helps, but it does not replace rest. If you feel '
              'sleepy, stop somewhere safe and take a short nap.',
            ),
          ],
        ),
      ),
    ],
  );
}

/// About the developer (same as the website's /about-me).
class AboutMeScreen extends StatelessWidget {
  const AboutMeScreen({super.key});

  static const _skills = [
    'Python',
    'JavaScript',
    'Flutter',
    'Tailwind CSS',
    'HTML',
    'React',
    'Node.js',
    'MongoDB',
  ];

  @override
  Widget build(BuildContext context) => _AboutFrame(
    title: 'About the developer',
    children: [
      GlassCard(
        interactive: false,
        child: Column(
          children: [
            ClipOval(
              child: Image.network(
                '$webAppUrl/about/me.jpg',
                key: const ValueKey('developer-photo'),
                width: 140,
                height: 140,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const CircleAvatar(
                  radius: 70,
                  child: Icon(Icons.person_rounded, size: 64),
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Engr. Emmanuel Christian V. Galang',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Senior Full Stack Developer · Creator of Guardian Drive',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.glow),
            ),
            _p(
              'I build complete products, from the camera and the AI in the car '
              'to the server, the website and the phone app.',
            ),
          ],
        ),
      ),
      GlassCard(
        interactive: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _h('Why I built Guardian Drive'),
            _p(
              'I was inspired to create this project to raise awareness of '
              'fatigue and drowsy driving, one of the quietest causes of road '
              'accidents.',
            ),
            _p(
              'Guardian Drive watches for the signs in real time and sends '
              'instant notifications to the parents, so someone who cares can '
              'step in before a tired moment becomes an accident.',
            ),
          ],
        ),
      ),
      GlassCard(
        interactive: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _h('Tech stack'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [for (final s in _skills) Chip(label: Text(s))],
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => launchUrl(
                Uri.parse('https://github.com/galangec24'),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.code_rounded),
              label: const Text('GitHub'),
            ),
          ],
        ),
      ),
    ],
  );
}
