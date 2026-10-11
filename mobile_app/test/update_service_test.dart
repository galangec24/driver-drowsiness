import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian_drive/services/update_service.dart';

/// Answers every request with a fixed GitHub "latest release" body.
class _FakeGitHub extends Interceptor {
  _FakeGitHub(this.body);
  final Map<String, dynamic> body;
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) =>
      handler.resolve(
        Response(requestOptions: options, statusCode: 200, data: body),
      );
}

UpdateService _service(Map<String, dynamic> body) =>
    UpdateService(dio: Dio()..interceptors.add(_FakeGitHub(body)));

void main() {
  test('version comparison is numeric, part by part', () {
    expect(isNewerVersion('v1.0.10', '1.0.9'), isTrue);
    expect(isNewerVersion('1.1.0', '1.0.99'), isTrue);
    expect(isNewerVersion('v1.0.4', '1.0.4'), isFalse);
    expect(isNewerVersion('1.0.3', '1.0.4+4'), isFalse);
  });

  test('a newer release with an APK is offered', () async {
    final update = await _service({
      'tag_name': 'v1.0.6',
      'body': 'Bug fixes',
      'assets': [
        {
          'name': 'GuardianDrive-Setup.exe',
          'browser_download_url': 'https://x/GuardianDrive-Setup.exe',
        },
        {
          'name': 'GuardianDrive.apk',
          'browser_download_url': 'https://x/GuardianDrive.apk',
        },
      ],
    }).check(current: '1.0.5');
    expect(update, isNotNull);
    expect(update!.version, '1.0.6');
    expect(update.apkUrl.toString(), 'https://x/GuardianDrive.apk');
    expect(update.notes, 'Bug fixes');
  });

  test('nothing to do when up to date or the release has no APK', () async {
    expect(
      await _service({'tag_name': 'v1.0.5', 'assets': []})
          .check(current: '1.0.5'),
      isNull,
    );
    expect(
      await _service({
        'tag_name': 'v1.0.6',
        'assets': [
          {
            'name': 'GuardianDrive-Setup.exe',
            'browser_download_url': 'https://x/s.exe',
          },
        ],
      }).check(current: '1.0.5'),
      isNull,
    );
  });
}
