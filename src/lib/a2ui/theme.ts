export type A2uiTheme = {
  additionalStyles: Record<string, unknown>;
  components: {
    AudioPlayer: Record<string, boolean>;
    Button: Record<string, boolean>;
    Card: Record<string, boolean>;
    CheckBox: {
      container: Record<string, boolean>;
      label: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    Column: Record<string, boolean>;
    DateTimeInput: {
      container: Record<string, boolean>;
      label: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    Divider: Record<string, boolean>;
    Icon: Record<string, boolean>;
    Image: {
      all: Record<string, boolean>;
      avatar: Record<string, boolean>;
      header: Record<string, boolean>;
      icon: Record<string, boolean>;
      largeFeature: Record<string, boolean>;
      mediumFeature: Record<string, boolean>;
      smallFeature: Record<string, boolean>;
    };
    List: Record<string, boolean>;
    MultipleChoice: {
      container: Record<string, boolean>;
      label: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    Modal: {
      backdrop: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    Row: Record<string, boolean>;
    Slider: {
      container: Record<string, boolean>;
      label: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    Tabs: {
      container: Record<string, boolean>;
      controls: {
        all: Record<string, boolean>;
        selected: Record<string, boolean>;
      };
      element: Record<string, boolean>;
    };
    Text: {
      all: Record<string, boolean>;
      h1: Record<string, boolean>;
      h2: Record<string, boolean>;
      h3: Record<string, boolean>;
      h4: Record<string, boolean>;
      h5: Record<string, boolean>;
      body: Record<string, boolean>;
      caption: Record<string, boolean>;
    };
    TextField: {
      container: Record<string, boolean>;
      label: Record<string, boolean>;
      element: Record<string, boolean>;
    };
    Video: Record<string, boolean>;
  };
  elements: Record<string, Record<string, boolean>>;
  markdown: Record<string, string[]>;
};

const emptyClasses: Record<string, boolean> = {};

const toClassMap = (classes: string): Record<string, boolean> => {
  const map: Record<string, boolean> = {};
  for (const name of classes.split(" ")) {
    if (!name) continue;
    map[name] = true;
  }
  return map;
};

export const defaultA2uiTheme: A2uiTheme = {
  additionalStyles: {
    Card: {
      background:
        "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03)), radial-gradient(120% 120% at 12% 8%, rgba(255,255,255,0.07), transparent)",
      border: "1px solid rgba(255,255,255,0.16)",
      boxShadow: "0 22px 40px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)",
      borderRadius: "14px",
      padding: "10px 16px 8px 16px",
      color: "rgba(255,255,255,0.9)",
      backdropFilter: "blur(10px)",
      width: "100%",
      maxWidth: "1080px",
      margin: "0 auto",
      position: "relative",
      paddingRight: "170px",
    },
    Row: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: "6px",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
    },
    Column: {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      minWidth: "0",
      flex: "1 1 auto",
    },
    Button: {
      height: "34px",
      padding: "0 14px",
      borderRadius: "8px",
      border: "none",
      color: "#fff",
      cursor: "pointer",
      background: "linear-gradient(90deg, #f59e0b, #f97316, #f43f5e)",
      boxShadow: "0 10px 20px rgba(245, 158, 11, 0.25)",
      fontWeight: 600,
      fontSize: "14px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      lineHeight: "1",
      whiteSpace: "nowrap",
      flexShrink: "0",
      marginLeft: "auto",
      position: "static",
      alignSelf: "flex-start",
    },
    Text: {
      h1: {},
      h2: {},
      h3: {
        margin: "0",
        lineHeight: "1.1",
        padding: "0",
      },
      h4: {},
      h5: {},
      h6: {},
      body: {
        fontSize: "15px",
        fontWeight: 600,
        lineHeight: "1.1",
        color: "#fff",
        margin: "0",
        padding: "0",
      },
      caption: {
        fontSize: "13px",
        lineHeight: "1.1",
        color: "rgba(255,255,255,0.5)",
        margin: "2px 0 0 0",
        padding: "0",
      },
    },
  },
  components: {
    AudioPlayer: emptyClasses,
    Button: emptyClasses,
    Card: emptyClasses,
    CheckBox: { container: emptyClasses, label: emptyClasses, element: emptyClasses },
    Column: emptyClasses,
    DateTimeInput: { container: emptyClasses, label: emptyClasses, element: emptyClasses },
    Divider: emptyClasses,
    Icon: emptyClasses,
    Image: {
      all: emptyClasses,
      avatar: emptyClasses,
      header: emptyClasses,
      icon: emptyClasses,
      largeFeature: emptyClasses,
      mediumFeature: emptyClasses,
      smallFeature: emptyClasses,
    },
    List: emptyClasses,
    MultipleChoice: { container: emptyClasses, label: emptyClasses, element: emptyClasses },
    Modal: { backdrop: emptyClasses, element: emptyClasses },
    Row: emptyClasses,
    Slider: { container: emptyClasses, label: emptyClasses, element: emptyClasses },
    Tabs: { container: emptyClasses, controls: { all: emptyClasses, selected: emptyClasses }, element: emptyClasses },
    Text: {
      all: emptyClasses,
      h1: emptyClasses,
      h2: emptyClasses,
      h3: emptyClasses,
      h4: emptyClasses,
      h5: emptyClasses,
      body: emptyClasses,
      caption: emptyClasses,
    },
    TextField: { container: emptyClasses, label: emptyClasses, element: emptyClasses },
    Video: emptyClasses,
  },
  elements: {
    a: emptyClasses,
    audio: emptyClasses,
    body: emptyClasses,
    button: emptyClasses,
    h1: emptyClasses,
    h2: emptyClasses,
    h3: emptyClasses,
    h4: emptyClasses,
    h5: emptyClasses,
    iframe: emptyClasses,
    input: emptyClasses,
    p: emptyClasses,
    pre: emptyClasses,
    textarea: emptyClasses,
    video: emptyClasses,
  },
  markdown: {
    p: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    ul: [],
    ol: [],
    li: [],
    a: [],
    strong: [],
    em: [],
  },
};
