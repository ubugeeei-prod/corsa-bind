#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../../src/bindings/c/corsa_ffi/include/corsa_utils.h"

static CorsaStrRef to_ref(const char *value) {
  CorsaStrRef out = {
      .ptr = (const uint8_t *)value,
      .len = value == NULL ? 0 : strlen(value),
  };
  return out;
}

static void print_last_error_and_exit(const char *context) {
  const CorsaString error = corsa_error_message_take();
  if (error.ptr != NULL && error.len != 0) {
    fprintf(stderr, "%s: %.*s\n", context, (int)error.len, error.ptr);
  } else {
    fprintf(stderr, "%s\n", context);
  }
  corsa_utils_string_free(error);
  exit(1);
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: bench <scenario> <iterations> [options-json]\n");
    return 2;
  }

  const char *scenario = argv[1];
  const int iterations = atoi(argv[2]);
  unsigned long long checksum = 0;

  if (strcmp(scenario, "classify_type_text") == 0) {
    for (int index = 0; index < iterations; ++index) {
      const CorsaString value = corsa_utils_classify_type_text(to_ref("Promise<string> | null"));
      checksum += value.len;
      corsa_utils_string_free(value);
    }
  } else if (strcmp(scenario, "spawn_initialize") == 0) {
    if (argc < 4) {
      fprintf(stderr, "spawn_initialize requires options-json\n");
      return 2;
    }
    const CorsaStrRef options = to_ref(argv[3]);
    for (int index = 0; index < iterations; ++index) {
      CorsaApiClient *client = corsa_api_client_spawn(options);
      if (client == NULL) {
        print_last_error_and_exit("spawn failed");
      }
      const CorsaString payload = corsa_api_client_initialize_json(client);
      checksum += payload.len;
      corsa_utils_string_free(payload);
      if (!corsa_api_client_close(client)) {
        corsa_api_client_free(client);
        print_last_error_and_exit("close failed");
      }
      corsa_api_client_free(client);
    }
  } else {
    fprintf(stderr, "unknown scenario: %s\n", scenario);
    return 2;
  }

  printf("%llu\n", checksum);
  return 0;
}
