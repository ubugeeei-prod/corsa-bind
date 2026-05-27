import Foundation
import CorsaUtils

enum BenchError: Error {
    case usage(String)
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args.count >= 2 else {
        throw BenchError.usage("usage: CorsaUtilsBench <scenario> <iterations> [options-json]")
    }
    let scenario = args[0]
    guard let iterations = Int(args[1]), iterations >= 0 else {
        throw BenchError.usage("invalid iterations: \(args[1])")
    }

    var checksum = 0

    switch scenario {
    case "classify_type_text":
        for _ in 0..<iterations {
            checksum += CorsaUtils.classifyTypeText("Promise<string> | null").count
        }
    case "spawn_initialize":
        guard args.count >= 3 else {
            throw BenchError.usage("spawn_initialize requires options-json")
        }
        let optionsJSON = args[2]
        for _ in 0..<iterations {
            let client = try CorsaApiClient.spawn(json: optionsJSON)
            checksum += try client.initializeJSON().count
            try client.close()
        }
    default:
        throw BenchError.usage("unknown scenario: \(scenario)")
    }

    print(checksum)
} catch let error as BenchError {
    switch error {
    case .usage(let message):
        fputs("\(message)\n", stderr)
        exit(2)
    }
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
