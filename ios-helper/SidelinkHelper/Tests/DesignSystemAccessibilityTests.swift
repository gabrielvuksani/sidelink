import XCTest
import UIKit
import SwiftUI
@testable import SidelinkHelper

final class DesignSystemAccessibilityTests: XCTestCase {
    func testAccentFilledControlsMeetTextContrastAcrossAppearances() throws {
        let appearances: [(UIUserInterfaceStyle, UIAccessibilityContrast)] = [
            (.light, .normal),
            (.light, .high),
            (.dark, .normal),
            (.dark, .high),
        ]

        for (style, contrast) in appearances {
            let traits = UITraitCollection { mutableTraits in
                mutableTraits.userInterfaceStyle = style
                mutableTraits.accessibilityContrast = contrast
            }
            let accent = UIColor(Color.slAccent).resolvedColor(with: traits)
            let foreground = UIColor(Color.slOnAccent).resolvedColor(with: traits)

            XCTAssertGreaterThanOrEqual(
                try contrastRatio(accent, foreground),
                4.5,
                "Accent controls must remain readable in \(style) appearance with \(contrast) contrast"
            )
        }
    }

    private func contrastRatio(_ lhs: UIColor, _ rhs: UIColor) throws -> CGFloat {
        let left = try relativeLuminance(lhs)
        let right = try relativeLuminance(rhs)
        return (max(left, right) + 0.05) / (min(left, right) + 0.05)
    }

    private func relativeLuminance(_ color: UIColor) throws -> CGFloat {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            throw XCTSkip("Unable to resolve design-system color components")
        }

        func linearize(_ component: CGFloat) -> CGFloat {
            component <= 0.04045
                ? component / 12.92
                : pow((component + 0.055) / 1.055, 2.4)
        }

        return 0.2126 * linearize(red)
            + 0.7152 * linearize(green)
            + 0.0722 * linearize(blue)
    }
}
