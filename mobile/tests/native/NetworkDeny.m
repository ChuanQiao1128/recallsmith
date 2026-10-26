// Copied Simulator QA shell only. No proxy, certificate or system network changes.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <errno.h>
extern int B2SocketCanary(void);

static void record(NSString *event) {
  NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/B2-network-deny.log"];
  [[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
                         withIntermediateDirectories:YES attributes:nil error:nil];
  NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!file) { [@"" writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil]; file = [NSFileHandle fileHandleForWritingAtPath:path]; }
  [file seekToEndOfFile]; [file writeData:[[event stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding]]; [file closeFile];
}

// Deny Internet sockets as well as NSURLSession. These interposes affect this app image only.
static int denyConnect(int fd, const struct sockaddr *address, socklen_t length) { errno = EACCES; return -1; }
static int denyConnectx(int fd, const sa_endpoints_t *endpoints, sae_associd_t assoc, unsigned flags,
                        const struct iovec *iov, unsigned count, size_t *length, sae_connid_t *conn) { errno = EACCES; return -1; }
static ssize_t denySendto(int fd, const void *data, size_t length, int flags, const struct sockaddr *to, socklen_t toLength) { errno = EACCES; return -1; }
static ssize_t denySendmsg(int fd, const struct msghdr *message, int flags) { errno = EACCES; return -1; }
#define INTERPOSE(replacement, original) __attribute__((used)) static struct { const void *a; const void *b; } interpose_##original __attribute__((section("__DATA,__interpose"))) = { (const void *)&replacement, (const void *)&original };
INTERPOSE(denyConnect, connect)
INTERPOSE(denyConnectx, connectx)
INTERPOSE(denySendto, sendto)
INTERPOSE(denySendmsg, sendmsg)

@interface B2DenyProtocol : NSURLProtocol @end
@implementation B2DenyProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
  return ![@[@"file", @"data"] containsObject:request.URL.scheme.lowercaseString];
}
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)startLoading {
  record(@"NSURLProtocol denied request (URL intentionally omitted)");
  [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorNotConnectedToInternet userInfo:nil]];
}
- (void)stopLoading {}
@end

@interface NSURLSessionConfiguration (B2Deny) @end
@implementation NSURLSessionConfiguration (B2Deny)
- (NSArray<Class> *)b2_protocolClasses { return [@[[B2DenyProtocol class]] arrayByAddingObjectsFromArray:[self b2_protocolClasses] ?: @[]]; }
@end

__attribute__((constructor)) static void installDeny(void) {
  @autoreleasepool {
    [NSURLProtocol registerClass:[B2DenyProtocol class]];
    Method original = class_getInstanceMethod([NSURLSessionConfiguration class], @selector(protocolClasses));
    Method replacement = class_getInstanceMethod([NSURLSessionConfiguration class], @selector(b2_protocolClasses));
    method_exchangeImplementations(original, replacement);
    BOOL socketDenied = B2SocketCanary();
    record(socketDenied ? @"native connect canary PASS: EACCES" : @"native connect canary FAIL");
    if (!socketDenied) abort(); // Fail closed before React Native starts.
    [[[NSURLSession sharedSession] dataTaskWithURL:[NSURL URLWithString:@"https://b2-canary.invalid/"]
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        BOOL denied = [error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorNotConnectedToInternet;
        record(denied ? @"native NSURLSession canary PASS: offline" : @"native NSURLSession canary FAIL");
        if (!denied) abort();
      }] resume];
  }
}
