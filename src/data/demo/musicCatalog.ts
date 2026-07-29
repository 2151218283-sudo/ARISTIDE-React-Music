import type {
  Comment,
  LyricDocument,
  Track,
  UserProfile,
} from "../../lib/music/models";

const demoAuthor: UserProfile = {
  id: "echoform-demo-author",
  nickname: "ECHOFORM Demo",
  avatarUrl: null,
  signature: null,
};

export const demoTracks: readonly Track[] = [
  {
    id: "demo-track-001",
    name: "Afterimage",
    artists: [
      { id: "demo-artist-001", name: "Quiet Form", avatarUrl: null },
    ],
    album: {
      id: "demo-album-001",
      name: "Studies in Motion",
      artworkUrl: null,
    },
    durationMs: 218_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "unknown",
    privilege: { fee: 0, maxQuality: "exhigh" },
  },
  {
    id: "demo-track-002",
    name: "Soft Geometry",
    artists: [
      { id: "demo-artist-002", name: "Signal Bloom", avatarUrl: null },
    ],
    album: {
      id: "demo-album-002",
      name: "Rooms Without Edges",
      artworkUrl: null,
    },
    durationMs: 194_000,
    artworkUrl: null,
    aliases: ["Study II"],
    explicit: false,
    availability: "unknown",
    privilege: { fee: 0, maxQuality: "lossless" },
  },
  {
    id: "demo-track-003",
    name: "Night Transit",
    artists: [
      { id: "demo-artist-003", name: "Low Horizon", avatarUrl: null },
    ],
    album: {
      id: "demo-album-003",
      name: "Northbound",
      artworkUrl: null,
    },
    durationMs: 241_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "unknown",
    privilege: { fee: 0, maxQuality: "hires" },
  },
  {
    id: "demo-track-004",
    name: "Glass Memory",
    artists: [
      { id: "demo-artist-001", name: "Quiet Form", avatarUrl: null },
    ],
    album: {
      id: "demo-album-004",
      name: "Residual Light",
      artworkUrl: null,
    },
    durationMs: 205_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "unknown",
    privilege: { fee: 0, maxQuality: "standard" },
  },
];

export const demoLyricsByTrackId: Readonly<Record<string, LyricDocument>> = {
  "demo-track-001": {
    kind: "synced",
    lines: [
      {
        startMs: 8_000,
        durationMs: 4_000,
        text: "A quiet shape moves through the room",
        translation: null,
        romanization: null,
        words: null,
      },
      {
        startMs: 12_000,
        durationMs: 4_000,
        text: "The afterimage stays",
        translation: null,
        romanization: null,
        words: null,
      },
    ],
  },
};

export const demoCommentsByTrackId: Readonly<Record<string, readonly Comment[]>> = {
  "demo-track-001": [
    {
      id: "demo-comment-001",
      author: demoAuthor,
      content: "Synthetic local comment for the ECHOFORM demo.",
      createdAt: 1_735_689_600_000,
      likedCount: 0,
      likedByCurrentUser: false,
      replyTo: null,
    },
  ],
};
