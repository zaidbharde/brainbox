import path from 'node:path';
import { writeWorkspaceFile } from './systemRunner.js';

const conioHeader = `#ifndef BRAINBOX_TURBO_CONIO_H
#define BRAINBOX_TURBO_CONIO_H

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/select.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifndef BLACK
#define BLACK 0
#define BLUE 1
#define GREEN 2
#define CYAN 3
#define RED 4
#define MAGENTA 5
#define BROWN 6
#define LIGHTGRAY 7
#define DARKGRAY 8
#define LIGHTBLUE 9
#define LIGHTGREEN 10
#define LIGHTCYAN 11
#define LIGHTRED 12
#define LIGHTMAGENTA 13
#define YELLOW 14
#define WHITE 15
#endif

static inline void clrscr(void) {
  fputs("\\033[2J\\033[H", stdout);
  fflush(stdout);
}

static inline int getch(void) {
  struct termios oldt;
  struct termios newt;
  int ch = EOF;

  if (tcgetattr(STDIN_FILENO, &oldt) != 0) {
    return getchar();
  }

  newt = oldt;
  newt.c_lflag &= (unsigned int) ~(ICANON | ECHO);
  tcsetattr(STDIN_FILENO, TCSANOW, &newt);
  ch = getchar();
  tcsetattr(STDIN_FILENO, TCSANOW, &oldt);

  return ch;
}

static inline int getche(void) {
  int ch = getch();
  if (ch != EOF) {
    putchar(ch);
    fflush(stdout);
  }
  return ch;
}

static inline int kbhit(void) {
  struct timeval tv;
  fd_set fds;

  tv.tv_sec = 0;
  tv.tv_usec = 0;

  FD_ZERO(&fds);
  FD_SET(STDIN_FILENO, &fds);

  return select(STDIN_FILENO + 1, &fds, NULL, NULL, &tv) > 0;
}

static inline void gotoxy(int x, int y) {
  if (x < 1) {
    x = 1;
  }
  if (y < 1) {
    y = 1;
  }
  printf("\\033[%d;%dH", y, x);
  fflush(stdout);
}

static inline void textcolor(int color) {
  int normalized = color;
  if (normalized < 0) {
    normalized = 0;
  }
  normalized %= 16;

  if (normalized < 8) {
    printf("\\033[%dm", 30 + normalized);
  } else {
    printf("\\033[%dm", 90 + (normalized - 8));
  }
  fflush(stdout);
}

static inline void textbackground(int color) {
  int normalized = color;
  if (normalized < 0) {
    normalized = 0;
  }
  normalized %= 8;
  printf("\\033[%dm", 40 + normalized);
  fflush(stdout);
}

static inline int cprintf(const char* fmt, ...) {
  va_list args;
  int written = 0;
  va_start(args, fmt);
  written = vprintf(fmt, args);
  va_end(args);
  fflush(stdout);
  return written;
}

static inline int cscanf(const char* fmt, ...) {
  va_list args;
  int readCount = 0;
  va_start(args, fmt);
  readCount = vfscanf(stdin, fmt, args);
  va_end(args);
  return readCount;
}

static inline void highvideo(void) {
  fputs("\\033[1m", stdout);
  fflush(stdout);
}

static inline void lowvideo(void) {
  fputs("\\033[2m", stdout);
  fflush(stdout);
}

static inline void normvideo(void) {
  fputs("\\033[0m", stdout);
  fflush(stdout);
}

static inline void window(int left, int top, int right, int bottom) {
  (void) left;
  (void) top;
  (void) right;
  (void) bottom;
}

#ifdef __cplusplus
}
#endif

#endif
`;

const dosHeader = `#ifndef BRAINBOX_TURBO_DOS_H
#define BRAINBOX_TURBO_DOS_H

#include <stdlib.h>
#include <time.h>
#include <unistd.h>

#ifdef __cplusplus
extern "C" {
#endif

static inline void delay(unsigned int ms) {
  usleep((useconds_t) ms * 1000u);
}

static inline void sound(unsigned int frequency) {
  (void) frequency;
}

static inline void nosound(void) {
}

static inline void randomize(void) {
  srand((unsigned int) time(NULL));
}

#ifndef random
#define random(max_value) ((max_value) > 0 ? (rand() % (max_value)) : 0)
#endif

#ifdef __cplusplus
}
#endif

#endif
`;

const graphicsHeader = `#ifndef BRAINBOX_TURBO_GRAPHICS_H
#define BRAINBOX_TURBO_GRAPHICS_H

#ifdef __cplusplus
extern "C" {
#endif

#ifndef DETECT
#define DETECT 0
#endif

#ifndef BLACK
#define BLACK 0
#define BLUE 1
#define GREEN 2
#define CYAN 3
#define RED 4
#define MAGENTA 5
#define BROWN 6
#define LIGHTGRAY 7
#define DARKGRAY 8
#define LIGHTBLUE 9
#define LIGHTGREEN 10
#define LIGHTCYAN 11
#define LIGHTRED 12
#define LIGHTMAGENTA 13
#define YELLOW 14
#define WHITE 15
#endif

typedef struct {
  int left;
  int top;
  int right;
  int bottom;
} viewporttype;

static inline void initgraph(int* graphdriver, int* graphmode, const char* pathtodriver) {
  (void) graphmode;
  (void) pathtodriver;
  if (graphdriver) {
    *graphdriver = DETECT;
  }
}

static inline void closegraph(void) {
}

static inline int getmaxx(void) {
  return 639;
}

static inline int getmaxy(void) {
  return 479;
}

static inline void cleardevice(void) {
}

static inline void setbkcolor(int color) {
  (void) color;
}

static inline void setcolor(int color) {
  (void) color;
}

static inline void setfillstyle(int pattern, int color) {
  (void) pattern;
  (void) color;
}

static inline void settextstyle(int font, int direction, int charsize) {
  (void) font;
  (void) direction;
  (void) charsize;
}

static inline void moveto(int x, int y) {
  (void) x;
  (void) y;
}

static inline void lineto(int x, int y) {
  (void) x;
  (void) y;
}

static inline void line(int x1, int y1, int x2, int y2) {
  (void) x1;
  (void) y1;
  (void) x2;
  (void) y2;
}

static inline void rectangle(int left, int top, int right, int bottom) {
  (void) left;
  (void) top;
  (void) right;
  (void) bottom;
}

static inline void bar(int left, int top, int right, int bottom) {
  (void) left;
  (void) top;
  (void) right;
  (void) bottom;
}

static inline void circle(int x, int y, int radius) {
  (void) x;
  (void) y;
  (void) radius;
}

static inline void fillellipse(int x, int y, int xradius, int yradius) {
  (void) x;
  (void) y;
  (void) xradius;
  (void) yradius;
}

static inline void ellipse(int x, int y, int stangle, int endangle, int xradius, int yradius) {
  (void) x;
  (void) y;
  (void) stangle;
  (void) endangle;
  (void) xradius;
  (void) yradius;
}

static inline void arc(int x, int y, int stangle, int endangle, int radius) {
  (void) x;
  (void) y;
  (void) stangle;
  (void) endangle;
  (void) radius;
}

static inline void putpixel(int x, int y, int color) {
  (void) x;
  (void) y;
  (void) color;
}

static inline void outtextxy(int x, int y, const char* textstring) {
  (void) x;
  (void) y;
  (void) textstring;
}

#ifdef __cplusplus
}
#endif

#endif
`;

export async function writeTurboCompatHeaders(workspace) {
  const includeDir = path.join(workspace, 'include');

  await writeWorkspaceFile(workspace, 'include/conio.h', conioHeader);
  await writeWorkspaceFile(workspace, 'include/dos.h', dosHeader);
  await writeWorkspaceFile(workspace, 'include/graphics.h', graphicsHeader);

  return includeDir;
}
