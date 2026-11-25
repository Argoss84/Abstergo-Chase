import 'dart:async';

import 'package:broken_veil_protocol/core/logging/app_logger.dart';
import 'package:broken_veil_protocol/features/account/data/account_api_service.dart';
import 'package:broken_veil_protocol/features/auth/application/cognito_auth_controller.dart';
import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';

class PlayBilling extends ChangeNotifier {
  PlayBilling(this.auth) {
    auth.addListener(_authChanged);
    if (supportsPurchases) {
      _purchases = InAppPurchase.instance.purchaseStream.listen((purchases) {
        unawaited(_resolvePurchases(purchases));
      });
    }
    _authChanged();
  }

  final CognitoAuthController auth;
  StreamSubscription<List<PurchaseDetails>>? _purchases;
  bool _authenticated = false;
  bool _disposed = false;
  bool _restored = false;
  int _generation = 0;
  Future<void>? _refreshing;

  Map<String, dynamic>? status;
  GooglePlayProductDetails? product;
  String? error;
  bool busy = false;

  bool get supportsPurchases =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  bool get adFree =>
      (status?['features'] as List?)?.contains('ads_free') == true;
  bool get canShowAds => status != null && !adFree;

  void _authChanged() {
    if (_authenticated == auth.isAuthenticated) return;
    _authenticated = auth.isAuthenticated;
    _generation++;
    status = null;
    product = null;
    error = null;
    _restored = false;
    _refreshing = null;
    notifyListeners();
    if (_authenticated) unawaited(refresh());
  }

  Future<Map<String, dynamic>> _request(
    String route, {
    Map<String, Object?>? body,
  }) async {
    final bearer = await auth.getAccessToken();
    if (bearer == null) {
      throw const SessionInvalidatedException('Reconnecte-toi à ton compte.');
    }
    return auth.accountApi.request(
      bearer,
      route,
      method: body == null ? 'GET' : 'POST',
      body: body,
    );
  }

  Future<void> refresh() {
    if (!_authenticated || _disposed) return Future.value();
    final generation = _generation;
    return _refreshing ??= _load(generation).whenComplete(() {
      if (generation == _generation) _refreshing = null;
    });
  }

  Future<void> _load(int generation) async {
    try {
      final value = await _request('/billing/me');
      if (_disposed || generation != _generation) return;
      status = value;
      error = null;
      notifyListeners();

      final productId = value['product_id'];
      final planId = value['base_plan_id'];
      if (!supportsPurchases || productId is! String || planId is! String) {
        return;
      }
      if (!await InAppPurchase.instance.isAvailable()) {
        throw StateError('Google Play indisponible');
      }
      final offers = await InAppPurchase.instance.queryProductDetails({
        productId,
      });
      if (_disposed || generation != _generation) return;
      final products = offers.productDetails
          .whereType<GooglePlayProductDetails>()
          .where((offer) {
            final index = offer.subscriptionIndex;
            return index != null &&
                offer
                        .productDetails
                        .subscriptionOfferDetails?[index]
                        .basePlanId ==
                    planId;
          });
      product = products.firstOrNull;
      if (product == null) {
        error = 'Offre indisponible sur cette piste Google Play.';
      }
      if (!_restored) {
        _restored = true;
        await InAppPurchase.instance.restorePurchases();
      }
    } catch (failure) {
      if (_disposed || generation != _generation) return;
      error = 'Impossible de vérifier l’abonnement pour le moment.';
      if (failure is SessionInvalidatedException) {
        await auth.handleSessionInvalidated(failure.message);
      }
      AppLogger.error(
        'Etat Google Play indisponible',
        source: 'billing.status',
      );
    } finally {
      if (!_disposed && generation == _generation) notifyListeners();
    }
  }

  Future<void> subscribe() async {
    final offer = product;
    final account = status?['obfuscated_account_id'];
    if (offer == null || account is! String || busy) return;
    await _run(() async {
      final started = await InAppPurchase.instance.buyNonConsumable(
        purchaseParam: GooglePlayPurchaseParam(
          productDetails: offer,
          offerToken: offer.offerToken,
          applicationUserName: account,
        ),
      );
      if (!started) throw StateError('Achat Google Play indisponible');
    });
  }

  Future<void> restore() async {
    if (!supportsPurchases || busy) return;
    await _run(() => InAppPurchase.instance.restorePurchases());
  }

  Future<void> _run(Future<void> Function() action) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      await action();
    } catch (_) {
      error = 'Opération Google Play indisponible.';
    } finally {
      busy = false;
      if (!_disposed) notifyListeners();
    }
  }

  Future<void> _resolvePurchases(List<PurchaseDetails> purchases) async {
    final generation = _generation;
    if (!_authenticated || _disposed) return;
    for (final purchase in purchases) {
      if (_disposed || generation != _generation) return;
      if (purchase.productID != status?['product_id']) continue;
      if (purchase.status == PurchaseStatus.pending) {
        error = 'Paiement en attente de confirmation Google Play.';
      } else if (purchase.status == PurchaseStatus.purchased ||
          purchase.status == PurchaseStatus.restored) {
        try {
          final value = await _request(
            '/billing/play/verify',
            body: {
              'purchase_token':
                  purchase.verificationData.serverVerificationData,
            },
          );
          if (_disposed || generation != _generation) return;
          // ServerBDD validates and acknowledges the purchase with Google.
          status = value;
          error = null;
        } catch (failure) {
          if (_disposed || generation != _generation) return;
          error = failure is AccountApiException
              ? failure.message
              : 'Impossible de vérifier l’achat.';
          AppLogger.error(
            'Achat Google Play à revérifier',
            source: 'billing.verify',
          );
        }
      } else if (purchase.status == PurchaseStatus.error) {
        error = 'Google Play a refusé cette transaction.';
      }
      if (!_disposed) notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    auth.removeListener(_authChanged);
    unawaited(_purchases?.cancel());
    super.dispose();
  }
}
