#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string_view>

#include "../../../src/bindings/cpp/corsa_api.hpp"

int main(int argc, char **argv) {
  if (argc < 3) {
    std::cerr << "usage: bench <scenario> <iterations> [options-json]\n";
    return 2;
  }

  const std::string_view scenario = argv[1];
  const int iterations = std::atoi(argv[2]);
  std::uint64_t checksum = 0;

  if (scenario == "classify_type_text") {
    for (int index = 0; index < iterations; ++index) {
      checksum += corsa::utils::classify_type_text("Promise<string> | null").size();
    }
  } else if (scenario == "spawn_initialize") {
    if (argc < 4) {
      std::cerr << "spawn_initialize requires options-json\n";
      return 2;
    }
    const std::string_view options_json = argv[3];
    for (int index = 0; index < iterations; ++index) {
      auto client = corsa::api::corsa_api_client::spawn(options_json);
      if (!client) {
        std::cerr << "spawn failed: " << corsa::api::take_last_error() << '\n';
        return 1;
      }
      checksum += client.initialize_json().size();
      if (!client.close()) {
        std::cerr << "close failed: " << corsa::api::take_last_error() << '\n';
        return 1;
      }
    }
  } else {
    std::cerr << "unknown scenario: " << scenario << '\n';
    return 2;
  }

  std::cout << checksum << '\n';
  return 0;
}
