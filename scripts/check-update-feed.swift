import Foundation

let expected = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let url = URL(string: "https://cdn.jsdelivr.net/gh/creeep123/hapi-companion@main/updates/appcast.xml")!
var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
request.setValue("application/rss+xml,*/*;q=0.1", forHTTPHeaderField: "Accept")
let (data, response) = try await URLSession.shared.data(for: request)
guard (response as? HTTPURLResponse)?.statusCode == 200, data == expected else {
    fputs("Native public feed differs from the reviewed feed or is unavailable.\n", stderr)
    exit(1)
}
print("Native public signed-feed bytes match reviewed source.")
