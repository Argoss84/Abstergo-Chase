import UIKit
import Flutter
import UserNotifications

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: "brokenveil/game_background", binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { call, result in
        let notifications = UNUserNotificationCenter.current()
        switch call.method {
        case "prepareAlerts":
          notifications.requestAuthorization(options: [.alert, .sound]) { _, _ in }
          result(nil)
        case "notifyObjectiveIntrusion":
          let objective = call.arguments as? String ?? "Objectif"
          let content = UNMutableNotificationContent()
          content.title = "Rogue détecté"
          content.body = "Un Rogue est dans votre zone · \(objective)"
          content.sound = .default
          notifications.add(UNNotificationRequest(
            identifier: "game-objective-\(objective)", content: content, trigger: nil
          ))
          result(nil)
        default:
          result(FlutterMethodNotImplemented)
        }
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
