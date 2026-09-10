// Local OCR for floor-plan images using macOS Vision. Nothing leaves the machine.
// Room labels on a plan are tiny, so the image is OCR'd in overlapping tiles, each scaled
// up, and the hits are mapped back to normalised full-image coordinates (x right, y down).
//   swift scripts/floorplans/ocr.swift <image.png> [tilePx=700] [scale=3]
// Prints JSON: { width, height, items: [{ text, conf, x, y, w, h }] }
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { FileHandle.standardError.write("usage: ocr.swift <image> [tilePx] [scale]\n".data(using: .utf8)!); exit(2) }
let tilePx = args.count >= 3 ? Int(args[2]) ?? 700 : 700
let scale = args.count >= 4 ? Int(args[3]) ?? 3 : 3
guard let img = NSImage(contentsOfFile: args[1]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot read \(args[1])\n".data(using: .utf8)!); exit(1)
}
let W = cg.width, H = cg.height
var out: [[String: Any]] = []

func recognise(_ tile: CGImage, ox: Int, oy: Int, tw: Int, th: Int) {
  // Upscale the tile: Vision reads 10 px digits far better at 30 px.
  let sw = tw * scale, sh = th * scale
  guard let ctx = CGContext(data: nil, width: sw, height: sh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return }
  ctx.interpolationQuality = .high
  ctx.draw(tile, in: CGRect(x: 0, y: 0, width: sw, height: sh))
  guard let big = ctx.makeImage() else { return }
  let req = VNRecognizeTextRequest { r, _ in
    guard let obs = r.results as? [VNRecognizedTextObservation] else { return }
    for o in obs {
      guard let c = o.topCandidates(1).first else { continue }
      let b = o.boundingBox // normalised within the tile, origin bottom-left
      let cx = (Double(ox) + b.midX * Double(tw)) / Double(W)
      let cy = (Double(oy) + (1 - b.midY) * Double(th)) / Double(H)
      out.append(["text": c.string, "conf": Double(c.confidence), "x": cx, "y": cy, "w": b.width * Double(tw) / Double(W), "h": b.height * Double(th) / Double(H)])
    }
  }
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: big, options: [:]).perform([req])
}

let step = tilePx * 3 / 4 // 25% overlap so a label on a seam is whole in one tile
var y = 0
while y < H {
  var x = 0
  let th = min(tilePx, H - y)
  while x < W {
    let tw = min(tilePx, W - x)
    if let tile = cg.cropping(to: CGRect(x: x, y: y, width: tw, height: th)) { recognise(tile, ox: x, oy: y, tw: tw, th: th) }
    if x + tw >= W { break }
    x += step
  }
  if y + th >= H { break }
  y += step
}
let data = try JSONSerialization.data(withJSONObject: ["width": W, "height": H, "items": out])
print(String(data: data, encoding: .utf8)!)
