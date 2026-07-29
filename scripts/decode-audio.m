#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#include <stdint.h>
#include <stdio.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 4) {
      fprintf(
        stderr,
        "usage: decode-audio <input> <output> <duration-seconds>\n"
      );
      return 2;
    }

    NSString *inputPath = [NSString stringWithUTF8String:argv[1]];
    NSString *outputPath = [NSString stringWithUTF8String:argv[2]];
    double duration = strtod(argv[3], NULL);
    if (duration <= 0) {
      fprintf(stderr, "duration must be a positive number\n");
      return 2;
    }

    NSError *error = nil;
    AVAudioFile *file = [[AVAudioFile alloc]
      initForReading:[NSURL fileURLWithPath:inputPath]
      error:&error
    ];
    if (file == nil) {
      fprintf(stderr, "could not open audio: %s\n", error.localizedDescription.UTF8String);
      return 1;
    }

    AVAudioFormat *format = file.processingFormat;
    AVAudioFramePosition requestedFrames =
      (AVAudioFramePosition)(duration * format.sampleRate);
    AVAudioFrameCount frameCount =
      (AVAudioFrameCount)MIN(file.length, requestedFrames);
    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc]
      initWithPCMFormat:format
      frameCapacity:frameCount
    ];
    if (buffer == nil) {
      fprintf(stderr, "could not allocate PCM buffer\n");
      return 1;
    }
    if (![file readIntoBuffer:buffer frameCount:frameCount error:&error]) {
      fprintf(stderr, "could not decode audio: %s\n", error.localizedDescription.UTF8String);
      return 1;
    }

    float *const *channels = buffer.floatChannelData;
    if (channels == NULL) {
      fprintf(stderr, "decoded audio is not available as Float32 PCM\n");
      return 1;
    }

    FILE *output = fopen(outputPath.fileSystemRepresentation, "wb");
    if (output == NULL) {
      fprintf(stderr, "could not open PCM output\n");
      return 1;
    }

    uint32_t sampleRate = (uint32_t)format.sampleRate;
    uint32_t sampleCount = (uint32_t)buffer.frameLength;
    fwrite(&sampleRate, sizeof(sampleRate), 1, output);
    fwrite(&sampleCount, sizeof(sampleCount), 1, output);

    const uint32_t channelCount = format.channelCount;
    for (uint32_t frame = 0; frame < sampleCount; frame += 1) {
      float mono = 0;
      for (uint32_t channel = 0; channel < channelCount; channel += 1) {
        mono += channels[channel][frame] / (float)channelCount;
      }
      fwrite(&mono, sizeof(mono), 1, output);
    }
    fclose(output);
  }
  return 0;
}
