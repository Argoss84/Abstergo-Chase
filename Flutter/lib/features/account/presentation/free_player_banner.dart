import 'dart:async';

import 'package:broken_veil_protocol/app/config/app_runtime_config.dart';
import 'package:broken_veil_protocol/app/providers.dart';
import 'package:broken_veil_protocol/features/account/application/play_billing.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

class FreePlayerBanner extends ConsumerStatefulWidget {
  const FreePlayerBanner({super.key});

  @override
  ConsumerState<FreePlayerBanner> createState() => _FreePlayerBannerState();
}

class _FreePlayerBannerState extends ConsumerState<FreePlayerBanner> {
  late final PlayBilling _billing;
  BannerAd? _banner;
  bool _loaded = false;
  bool _loading = false;
  bool _privacyRequired = false;

  bool get _enabled =>
      !kIsWeb &&
      defaultTargetPlatform == TargetPlatform.android &&
      AppRuntimeConfig.adMobBannerId.isNotEmpty &&
      _billing.canShowAds;

  @override
  void initState() {
    super.initState();
    _billing = ref.read(playBillingProvider)..addListener(_update);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _update();
    });
  }

  void _update() {
    if (!_enabled) {
      _banner?.dispose();
      _banner = null;
      if (mounted && (_loaded || _privacyRequired)) {
        setState(() {
          _loaded = false;
          _privacyRequired = false;
        });
      }
      return;
    }
    if (_loading || _banner != null) return;
    unawaited(_load());
  }

  Future<void> _load() async {
    _loading = true;
    try {
      final consent = ConsentInformation.instance;
      final update = Completer<void>();
      consent.requestConsentInfoUpdate(
        ConsentRequestParameters(),
        () => update.complete(),
        (_) => update.complete(),
      );
      await update.future.timeout(const Duration(seconds: 12));
      if (!mounted || !_enabled) return;
      await ConsentForm.loadAndShowConsentFormIfRequired((_) {});
      final privacy = await consent.getPrivacyOptionsRequirementStatus();
      if (!mounted || !_enabled) return;
      setState(
        () => _privacyRequired =
            privacy == PrivacyOptionsRequirementStatus.required,
      );
      if (!await consent.canRequestAds() || !mounted || !_enabled) return;
      await MobileAds.instance.initialize();
      if (!mounted || !_enabled) return;

      final banner = BannerAd(
        size: AdSize.banner,
        adUnitId: AppRuntimeConfig.adMobBannerId,
        request: const AdRequest(),
        listener: BannerAdListener(
          onAdLoaded: (ad) {
            if (mounted && _enabled && identical(ad, _banner)) {
              setState(() => _loaded = true);
            }
          },
          onAdFailedToLoad: (ad, _) {
            if (identical(_banner, ad)) _banner = null;
            ad.dispose();
          },
        ),
      );
      _banner = banner;
      await banner.load();
    } catch (_) {
      _banner?.dispose();
      _banner = null;
    } finally {
      _loading = false;
    }
  }

  @override
  void dispose() {
    _billing.removeListener(_update);
    _banner?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final banner = _banner;
    if (!_enabled || ((!_loaded || banner == null) && !_privacyRequired)) {
      return const SizedBox.shrink();
    }
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_loaded && banner != null)
            SizedBox(
              width: banner.size.width.toDouble(),
              height: banner.size.height.toDouble(),
              child: AdWidget(ad: banner),
            ),
          if (_privacyRequired)
            TextButton(
              onPressed: () async {
                await ConsentForm.showPrivacyOptionsForm((_) {});
                if (!mounted) return;
                await _banner?.dispose();
                setState(() {
                  _banner = null;
                  _loaded = false;
                });
                _update();
              },
              child: const Text('Confidentialité publicitaire'),
            ),
        ],
      ),
    );
  }
}
