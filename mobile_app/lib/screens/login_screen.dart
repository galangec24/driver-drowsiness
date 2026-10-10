import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../services/api_service.dart';
import '../state/auth_controller.dart';
import '../widgets/depth_button.dart';
import '../widgets/floating_shapes.dart';
import '../widgets/glass_card.dart';
import '../widgets/mesh_background.dart';
import '../widgets/orbit_loader.dart';
import '../widgets/otp_view.dart';
import '../widgets/tilt_3d.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  late final TextEditingController _server;
  bool _register = false;
  bool _loading = false;
  bool _showServer = false;
  bool _obscure = true;
  // Waiting for the e-mailed code (new account, or sign-in before verifying).
  VerificationRequired? _pending;
  Map<String, String> _errors = {};
  String? _formError;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(
      text: context.read<AuthController>().serverUrl,
    );
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final auth = context.read<AuthController>();
    final errors = validateAuthForm(
      register: _register,
      name: _name.text,
      email: _email.text,
      password: _password.text,
    );
    setState(() {
      _errors = errors;
      _formError = null;
    });
    if (errors.isNotEmpty) return;

    setState(() => _loading = true);
    try {
      if (_server.text.trim() != auth.serverUrl) {
        await auth.setServerUrl(_server.text);
      }
      if (_register) {
        await auth.register(_name.text, _email.text, _password.text);
      } else {
        await auth.login(_email.text, _password.text);
      }
    } on VerificationRequired catch (v) {
      setState(() => _pending = v);
    } on ApiException catch (e) {
      setState(() => _formError = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _otp(VerificationRequired pending) {
    final auth = context.read<AuthController>();
    return OtpView(
      email: pending.email,
      retryAfterS: pending.retryAfterS,
      onVerify: (code) => auth.verifyEmail(pending.email, code),
      onResend: () => auth.resendCode(pending.email),
      onBack: () => setState(() {
        _pending = null;
        _register = false;
      }),
    );
  }

  Widget _field(
    String key,
    String label,
    TextEditingController c, {
    required IconData icon,
    bool obscure = false,
    TextInputType? type,
    List<String>? autofill,
    Widget? suffix,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        key: ValueKey('field-$key'),
        controller: c,
        obscureText: obscure,
        keyboardType: type,
        autofillHints: autofill,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          labelText: label,
          errorText: _errors[key],
          prefixIcon: Icon(icon, key: ValueKey('icon-$key')),
          prefixIconColor: WidgetStateColor.resolveWith(
            (states) => states.contains(WidgetState.focused)
                ? AppColors.glow
                : AppColors.muted,
          ),
          suffixIcon: suffix,
        ),
        onSubmitted: (_) => _submit(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: MeshBackground(
        child: Stack(
          children: [
            const Positioned.fill(child: FloatingShapes()),
            SafeArea(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 440),
                    child: Column(
                      children: [
                        Image.asset('assets/icon.png', width: 88, height: 88)
                            .animate(onPlay: (c) => c.repeat(reverse: true))
                            .moveY(
                              begin: 0,
                              end: -8,
                              duration: 3.seconds,
                              curve: Curves.easeInOut,
                            )
                            .animate()
                            .flipH(duration: 900.ms, curve: Curves.easeOutBack)
                            .fadeIn(duration: 400.ms),
                        const SizedBox(height: 12),
                        const Text(
                          'Guardian Drive',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 28,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const Text(
                          'Know they’re awake at the wheel.',
                          style: TextStyle(color: AppColors.muted),
                        ),
                        const SizedBox(height: 24),
                        Tilt3D(
                          child: Stack(
                            children: [
                              GlassCard(
                                interactive: false,
                                padding: const EdgeInsets.all(24),
                                child: _pending != null
                                    ? _otp(_pending!)
                                    : Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: [
                                          SegmentedButton<bool>(
                                            segments: const [
                                              ButtonSegment(
                                                value: false,
                                                label: Text('Sign in'),
                                              ),
                                              ButtonSegment(
                                                value: true,
                                                label: Text('Create account'),
                                              ),
                                            ],
                                            selected: {_register},
                                            showSelectedIcon: false,
                                            onSelectionChanged: (s) =>
                                                setState(() {
                                                  _register = s.first;
                                                  _errors = {};
                                                  _formError = null;
                                                }),
                                          ),
                                          const SizedBox(height: 20),
                                          AnimatedSize(
                                            duration: AppMotion.page,
                                            child: _register
                                                ? _field(
                                                    'name',
                                                    'Your name',
                                                    _name,
                                                    icon: Icons.person_rounded,
                                                    autofill: const [
                                                      AutofillHints.name,
                                                    ],
                                                  )
                                                : const SizedBox(
                                                    width: double.infinity,
                                                  ),
                                          ),
                                          _field(
                                            'email',
                                            'Email',
                                            _email,
                                            icon: Icons.mail_rounded,
                                            type: TextInputType.emailAddress,
                                            autofill: const [
                                              AutofillHints.email,
                                            ],
                                          ),
                                          _field(
                                            'password',
                                            'Password',
                                            _password,
                                            icon: Icons.lock_rounded,
                                            obscure: _obscure,
                                            autofill: const [
                                              AutofillHints.password,
                                            ],
                                            suffix: IconButton(
                                              key: const ValueKey(
                                                'toggle-password',
                                              ),
                                              tooltip: _obscure
                                                  ? 'Show password'
                                                  : 'Hide password',
                                              icon: Icon(
                                                _obscure
                                                    ? Icons.visibility_rounded
                                                    : Icons
                                                          .visibility_off_rounded,
                                              ),
                                              onPressed: () => setState(
                                                () => _obscure = !_obscure,
                                              ),
                                            ),
                                          ),
                                          if (_showServer)
                                            _field(
                                              'server',
                                              'Server URL',
                                              _server,
                                              icon: Icons.dns_rounded,
                                              type: TextInputType.url,
                                            ),
                                          if (_formError != null)
                                            Container(
                                              margin: const EdgeInsets.only(
                                                bottom: 14,
                                              ),
                                              padding: const EdgeInsets.all(12),
                                              decoration: BoxDecoration(
                                                color: AppColors.danger
                                                    .withValues(alpha: 0.12),
                                                borderRadius:
                                                    BorderRadius.circular(12),
                                                border: Border.all(
                                                  color: AppColors.danger
                                                      .withValues(alpha: 0.4),
                                                ),
                                              ),
                                              child: Text(
                                                _formError!,
                                                style: const TextStyle(
                                                  color: Color(0xFFFECACA),
                                                ),
                                              ),
                                            ),
                                          DepthButton(
                                            key: const ValueKey('submit'),
                                            label: _register
                                                ? 'Create account'
                                                : 'Sign in',
                                            loading: _loading,
                                            expand: true,
                                            onPressed: _submit,
                                          ),
                                          const SizedBox(height: 8),
                                          TextButton(
                                            onPressed: () => setState(
                                              () => _showServer = !_showServer,
                                            ),
                                            child: Text(
                                              _showServer
                                                  ? 'Hide server settings'
                                                  : 'Server: ${context.watch<AuthController>().serverUrl}',
                                              style: const TextStyle(
                                                color: AppColors.muted,
                                                fontSize: 12,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                              ),
                              if (_loading)
                                Positioned.fill(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(
                                      AppMotion.radius,
                                    ),
                                    child: ColoredBox(
                                      color: AppColors.ink950.withValues(
                                        alpha: 0.8,
                                      ),
                                      child: Center(
                                        child: OrbitLoader(
                                          label: _register
                                              ? 'Creating your account…'
                                              : 'Signing you in…',
                                        ),
                                      ),
                                    ),
                                  ).animate().fadeIn(duration: 200.ms),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
