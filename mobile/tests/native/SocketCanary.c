// Separate image: dyld deliberately does not interpose calls from the interposer's own image.
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <errno.h>
int B2SocketCanary(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in target = { .sin_len = sizeof(target), .sin_family = AF_INET,
        .sin_port = htons(9), .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
    int result = connect(fd, (const struct sockaddr *)&target, sizeof(target));
    int denied = result == -1 && errno == EACCES;
    close(fd);
    return denied;
}
