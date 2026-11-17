// How long a file of the Activity log is. The screen reads it too, so it stands apart from how a file is written.

/** The most entries one file of the log holds: a whole number of the 1,000 entries one reading of the log answers. A longer log is saved as one file after another, so no request works longer than the time one is given. */
export const MOST_IN_FILE = 2000;
