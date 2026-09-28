// Run on macOS 14+: xcrun swift scripts/prepare-speaker.swift input.png output.png
// Uses Apple's local foreground mask. The original image is never modified.
import AppKit
import CoreImage
import Vision

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: xcrun swift scripts/prepare-speaker.swift input.png output.png\n", stderr)
    exit(1)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
guard sourceURL != outputURL else {
    fputs("Choose a different output path to preserve the original.\n", stderr)
    exit(1)
}

do {
    let handler = VNImageRequestHandler(url: sourceURL, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
        throw NSError(domain: "PrepareSpeaker", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "No foreground subject found."])
    }
    let masked = try observation.generateMaskedImage(
        ofInstances: observation.allInstances,
        from: handler,
        croppedToInstancesExtent: true
    )
    let maskedSubject = CIImage(cvPixelBuffer: masked)
    // Contract only the alpha edge by one source pixel to remove background
    // color fringes. The original foreground RGB is used unchanged.
    let edgeMask = maskedSubject.applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": 1])
    let subject = maskedSubject.applyingFilter("CIBlendWithAlphaMask", parameters: [
        kCIInputBackgroundImageKey: CIImage(color: .clear).cropped(to: maskedSubject.extent),
        kCIInputMaskImageKey: edgeMask
    ]).cropped(to: maskedSubject.extent)
    let padding = ceil(max(subject.extent.width, subject.extent.height) * 0.01)
    let extent = CGRect(x: 0, y: 0,
                        width: subject.extent.width + padding * 2,
                        height: subject.extent.height + padding * 2)
    let padded = subject.transformed(by: CGAffineTransform(translationX: padding - subject.extent.minX,
                                                         y: padding - subject.extent.minY))
        .composited(over: CIImage(color: .clear).cropped(to: extent))
    let context = CIContext()
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(),
                                            withIntermediateDirectories: true)
    try context.writePNGRepresentation(of: padded, to: outputURL,
                                       format: .RGBA8, colorSpace: colorSpace)
    print("Saved \(Int(extent.width)) × \(Int(extent.height)) transparent PNG to \(outputURL.path)")
} catch {
    fputs("Could not prepare portrait: \(error.localizedDescription)\n", stderr)
    exit(1)
}
