import * as events from "events";
import {attributesFlyweight, defaultAttributes, createChar, Char} from "./Char";
import * as i from "./Interfaces";
import * as e from "./Enums";
import {List} from "immutable";
import {Color, Weight, Brightness, KeyCode, LogLevel, BufferType, ScreenMode} from "./Enums";
import {Attributes, TerminalLikeDevice, ColorCode} from "./Interfaces";
import {print, error, info, csi, times} from "./utils/Common";
import * as _ from "lodash";

const ansiParserConstructor: typeof AnsiParser = require("node-ansiparser");

interface HandlerResult {
    status: string;
    description: string;
    longDescription?: string;
    url: string;
}

interface SavedState {
    cursorRowIndex: number;
    cursorColumnIndex: number;
    attributes: i.Attributes;
    designatedCharacterSets: DesignatedCharacterSets;
    selectedCharacterSet: SelectedCharacterSet;
}

/**
 * @link http://vt100.net/docs/vt220-rm/chapter4.html
 */
enum CharacterSets {
    ASCIIGraphics,
    SupplementalGraphics,
}

interface DesignatedCharacterSets {
    G0: CharacterSets;
    G1: CharacterSets;
    G2: CharacterSets;
    G3: CharacterSets;
}

type SelectedCharacterSet = keyof DesignatedCharacterSets;

function or1(value: number | undefined) {
    if (value === undefined) {
        return 1;
    } else {
        return value;
    }
}


// TODO: Move to
function logPosition(buffer: Buffer) {
    const position = {rowIndex: buffer.cursorRowIndex, columnIndex: buffer.cursorColumnIndex};
    const char = buffer.at(position);
    const value = char ? char.value : "NULL";
    info(`%crow: ${position.rowIndex + 1}\tcolumn: ${buffer.cursorColumnIndex + 1}\t value: ${value}, rows: ${buffer.size}`, "color: grey");
}

/**
 * Copied from xterm.js
 * @link https://github.com/sourcelair/xterm.js/blob/master/src/Charsets.ts
 */
const graphicCharset: Dictionary<string> = {
    "`": "\u25c6", // "◆"
    "a": "\u2592", // "▒"
    "b": "\u0009", // "\t"
    "c": "\u000c", // "\f"
    "d": "\u000d", // "\r"
    "e": "\u000a", // "\n"
    "f": "\u00b0", // "°"
    "g": "\u00b1", // "±"
    "h": "\u2424", // "\u2424" (NL)
    "i": "\u000b", // "\v"
    "j": "\u2518", // "┘"
    "k": "\u2510", // "┐"
    "l": "\u250c", // "┌"
    "m": "\u2514", // "└"
    "n": "\u253c", // "┼"
    "o": "\u23ba", // "⎺"
    "p": "\u23bb", // "⎻"
    "q": "\u2500", // "─"
    "r": "\u23bc", // "⎼"
    "s": "\u23bd", // "⎽"
    "t": "\u251c", // "├"
    "u": "\u2524", // "┤"
    "v": "\u2534", // "┴"
    "w": "\u252c", // "┬"
    "x": "\u2502", // "│"
    "y": "\u2264", // "≤"
    "z": "\u2265", // "≥"
    "{": "\u03c0", // "π"
    "|": "\u2260", // "≠"
    "}": "\u00a3", // "£"
    "~": "\u00b7", // "·"
};

const SGR: { [indexer: string]: (attributes: Attributes) => Attributes } = {
    0: (_attributes: Attributes) => defaultAttributes,
    1: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright}),
    2: (attributes: Attributes) => ({...attributes, weight: Weight.Faint}),
    4: (attributes: Attributes) => ({...attributes, underline: true}),
    7: (attributes: Attributes) => ({...attributes, inverse: true}),
    22: (attributes: Attributes) => ({...attributes, weight: Weight.Normal}),
    24: (attributes: Attributes) => ({...attributes, underline: false}),
    27: (attributes: Attributes) => ({...attributes, inverse: false}),
    30: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Black}),
    31: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Red}),
    32: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Green}),
    33: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Yellow}),
    34: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Blue}),
    35: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Magenta}),
    36: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.Cyan}),
    37: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.White}),
    39: (attributes: Attributes) => ({...attributes, color: <ColorCode>Color.White}),
    40: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Black}),
    41: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Red}),
    42: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Green}),
    43: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Yellow}),
    44: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Blue}),
    45: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Magenta}),
    46: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Cyan}),
    47: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.White}),
    49: (attributes: Attributes) => ({...attributes, backgroundColor: <ColorCode>Color.Black}),
    90: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Black}),
    91: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Red}),
    92: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Green}),
    93: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Yellow}),
    94: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Blue}),
    95: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Magenta}),
    96: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.Cyan}),
    97: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, color: <ColorCode>Color.White}),
    100: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Black}),
    101: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Red}),
    102: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Green}),
    103: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Yellow}),
    104: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Blue}),
    105: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Magenta}),
    106: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.Cyan}),
    107: (attributes: Attributes) => ({...attributes, brightness: Brightness.Bright, backgroundColor: <ColorCode>Color.White}),
};

const CSI = {
    erase: {
        toEnd: 0,
        toBeginning: 1,
        entire: 2,
        entireSsh: 3,
    },
};

const colorFormatCodes = {
    format8bit: 5,
    formatTrueColor: 2,
};

export class Output extends events.EventEmitter {
    public activeBufferType = e.BufferType.Normal;
    public isCursorKeysModeSet = false;
    public screenMode = ScreenMode.Dark;
    private normalBuffer: Buffer;
    private alternateBuffer: Buffer;
    private parser: AnsiParser;

    constructor(private terminalDevice: TerminalLikeDevice, public dimensions: Dimensions) {
        super();

        this.normalBuffer = new Buffer(this, 200);
        this.alternateBuffer = new Buffer(this, 0);

        this.parser = new ansiParserConstructor({
            inst_p: (text: string) => {
                info("text", text, text.split("").map(letter => letter.charCodeAt(0)));

                for (let i = 0; i !== text.length; ++i) {
                    this.activeBuffer.writeOne(text.charAt(i));
                }

                logPosition(this.activeBuffer);
            },
            inst_o: function (s: any) {
                error("osc", s);
            },
            inst_x: (flag: string) => {
                this.activeBuffer.writeOne(flag);

                print((KeyCode[flag.charCodeAt(0)] ? LogLevel.Log : LogLevel.Error), ["char", flag.split("").map((_, index) => flag.charCodeAt(index))]);
                logPosition(this.activeBuffer);
            },
            /**
             * CSI handler.
             */
            inst_c: (collected: any, params: Array<number>, flag: string) => {
                let handlerResult: HandlerResult;
                if (collected === "?") {
                    if (params.length !== 1) {
                        return error(`CSI private mode has ${params.length} parameters: ${params}`);
                    }
                    if (flag !== "h" && flag !== "l") {
                        return error(`CSI private mode has an incorrect flag: ${flag}`);
                    }
                    const mode = params[0];
                    handlerResult = this.decPrivateModeHandler(mode, flag);

                    if (handlerResult.status === "handled") {
                        info(`%cCSI ? ${mode} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                    } else {
                        error(`%cCSI ? ${mode} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                    }
                } else {
                    handlerResult = this.csiHandler(collected, params, flag);

                    if (handlerResult.status === "handled") {
                        info(`%cCSI ${params} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                    } else {
                        error(`%cCSI ${params} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                    }
                }

                logPosition(this.activeBuffer);
            },
            /**
             * ESC handler.
             */
            inst_e: (collected: any, flag: string) => {
                const handlerResult = this.escapeHandler(collected, flag);

                if (handlerResult.status === "handled") {
                    info(`%cESC ${collected} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                } else {
                    error(`%cESC ${collected} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                }

                logPosition(this.activeBuffer);
            },
        });
    }

    write(ansiString: string) {
        this.parser.parse(ansiString);
        this.emit("data");
    }

    toLines() {
        return this.activeBuffer.toLines();
    }

    toString(): string {
        return this.toLines().join("\n");
    }

    isEmpty(): boolean {
        return this.activeBuffer.size === 0;
    }

    get activeBuffer() {
        if (this.activeBufferType === e.BufferType.Normal) {
            return this.normalBuffer;
        } else {
            return this.alternateBuffer;
        }
    }

    private escapeHandler(collected: any, flag: string) {
        let short = "";
        let long = "";
        let url = "";
        let status = "handled";

        if (collected) {
            if (collected === "#" && flag === "8") {
                short = "DEC Screen Alignment Test (DECALN).";
                url = "http://www.vt100.net/docs/vt510-rm/DECALN";

                const dimensions = this.activeBuffer.dimensions;

                for (let i = 0; i !== dimensions.rows; ++i) {
                    this.activeBuffer.moveCursorAbsolute({rowIndex: i, columnIndex: 0});
                    this.write(Array(dimensions.columns).join("E"));
                }

                this.activeBuffer.moveCursorAbsolute({rowIndex: 0, columnIndex: 0});
            } else if (collected === "(" && flag === "0") {
                short = "Designate Graphic Charset to G0";
                this.activeBuffer.designatedCharacterSets.G0 = CharacterSets.SupplementalGraphics;
            } else if (collected === "(" && flag === "B") {
                short = "Designate ASCII Charset to G0";
                this.activeBuffer.designatedCharacterSets.G0 = CharacterSets.ASCIIGraphics;
            } else if (collected === ")" && flag === "0") {
                short = "Designate Graphic Charset to G1";
                this.activeBuffer.designatedCharacterSets.G1 = CharacterSets.SupplementalGraphics;
            } else if (collected === ")" && flag === "B") {
                short = "Designate ASCII Charset to G1";
                this.activeBuffer.designatedCharacterSets.G1 = CharacterSets.ASCIIGraphics;
            } else {
                status = "unhandled";
            }
        } else {
            switch (flag) {
                case "A":
                    short = "Cursor up.";

                    this.activeBuffer.moveCursorRelative({vertical: -1});
                    break;
                case "B":
                    short = "Cursor down.";

                    this.activeBuffer.moveCursorRelative({vertical: 1});
                    break;
                case "C":
                    short = "Cursor right.";

                    this.activeBuffer.moveCursorRelative({horizontal: 1});
                    break;
                case "D":
                    short = "Index (IND).";
                    url = "http://www.vt100.net/docs/vt510-rm/IND";

                    this.activeBuffer.moveCursorRelative({vertical: 1});
                    break;
                case "H":
                    short = "Horizontal Tab Set (HTS).";
                    url = "http://www.vt100.net/docs/vt510-rm/HTS";

                    this.activeBuffer.setTabStop();
                    break;
                case "M":
                    short = "Reverse Index (RI).";
                    /* tslint:disable:max-line-length */
                    long = "Move the active position to the same horizontal position on the preceding line if the active position is at the top margin, a scroll down is performed.";

                    if (this.activeBuffer.cursorRowIndex === this.activeBuffer.marginTop) {
                        this.activeBuffer.scrollDown(1);
                    } else {
                        this.activeBuffer.moveCursorRelative({vertical: -1});
                    }
                    break;
                case "E":
                    short = "Next Line (NEL).";
                    /* tslint:disable:max-line-length */
                    long = "This sequence causes the active position to move to the first position on the next line downward. If the active position is at the bottom margin, a scroll up is performed.";

                    this.activeBuffer.moveCursorRelative({vertical: 1});
                    this.activeBuffer.moveCursorAbsolute({columnIndex: 0});
                    break;
                case "7":
                    long = "Save current state (cursor coordinates, attributes, character sets pointed at by G0, G1).";
                    this.activeBuffer.saveCurrentState();
                    break;
                case "8":
                    long = "Restore state most recently saved by ESC 7.";
                    this.activeBuffer.restoreCurrentState();
                    break;
                default:
                    status = "unhandled";
            }
        }

        return {
            status: status,
            description: short,
            longDescription: long,
            url: url,
        };
    }

    private decPrivateModeHandler(ps: number, flag: "h" | "l"): HandlerResult {
        let description = "";
        let url = "";
        let status: "handled" | "unhandled" = "handled";
        let shouldSet = flag === "h";

        // noinspection FallThroughInSwitchStatementJS
        switch (ps) {
            case 1:
                description = "Cursor Keys Mode.";
                url = "http://www.vt100.net/docs/vt510-rm/DECCKM";

                this.isCursorKeysModeSet = shouldSet;
                break;
            case 3:
                url = "http://www.vt100.net/docs/vt510-rm/DECCOLM";

                if (shouldSet) {
                    description = "132 Column Mode (DECCOLM).";

                    this.dimensions = {columns: 132, rows: this.activeBuffer.dimensions.rows};
                } else {
                    description = "80 Column Mode (DECCOLM).";

                    this.dimensions = {columns: 80, rows: this.activeBuffer.dimensions.rows};
                }
                this.activeBuffer.clear();
                // TODO
                // If you change the DECCOLM setting, the terminal:
                //      Sets the left, right, top and bottom scrolling margins to their default positions.
                //      Erases all data in page memory.
                // DECCOLM resets vertical split screen mode (DECLRMM) to unavailabl
                // DECCOLM clears data from the status line if the status line is set to host-writabl
                break;
            case 5:
                description = "Reverse Video (DECSCNM).";
                url = "http://www.vt100.net/docs/vt510-rm/DECSCNM";

                this.screenMode = (shouldSet ? ScreenMode.Light : ScreenMode.Dark);
                break;
            case 6:
                description = "Origin Mode (DECOM).";
                url = "http://www.vt100.net/docs/vt510-rm/DECOM";

                this.activeBuffer.isOriginModeSet = shouldSet;
                break;
            case 7:
                description = "Wraparound Mode (DECAWM).";
                url = "http://www.vt100.net/docs/vt510-rm/DECAWM";

                this.activeBuffer.isAutowrapModeSet = shouldSet;
                break;
            case 12:
                if (shouldSet) {
                    description = "Start Blinking Cursor (att610).";

                    this.activeBuffer.blinkCursor(true);
                } else {
                    description = "Stop Blinking Cursor (att610).";

                    this.activeBuffer.blinkCursor(false);
                }

                break;
            case 25:
                url = "http://www.vt100.net/docs/vt510-rm/DECTCEM";

                if (shouldSet) {
                    description = "Show Cursor (DECTCEM).";

                    this.activeBuffer.showCursor(true);
                } else {
                    description = "Hide Cursor (DECTCEM).";

                    this.activeBuffer.showCursor(false);
                }
                break;
            case 1049:
                if (shouldSet) {
                    /* tslint:disable:max-line-length */
                    description = "Save cursor as in DECSC and use Alternate Screen Buffer, clearing it first.  (This may be disabled by the titeInhibit resource).  This combines the effects of the 1047  and 1048  modes.  Use this with terminfo-based applications rather than the 47  mod";

                    this.activeBufferType = BufferType.Alternate;
                } else {
                    // TODO: Add Implementation
                    status = "unhandled";
                }
                break;
            case 2004:
                if (shouldSet) {
                    description = "Set bracketed paste mod";
                } else {
                    // TODO: Add Implementation
                    status = "unhandled";
                }
                break;
            default:
                status = "unhandled";
        }

        return {
            status: status,
            description: description,
            url: url,
        };
    }

    private csiHandler(_collected: any, rawParams: number[] | number, flag: string): HandlerResult {
        let short = "";
        let long = "";
        let url = "";
        let status = "handled";

        let params: number[] = Array.isArray(rawParams) ? rawParams : [];
        const param: number = params[0] || 0;

        switch (flag) {
            case "A":
                short = "Cursor Up Ps Times (default = 1) (CUU).";

                this.activeBuffer.moveCursorRelative({vertical: -(param || 1)});
                break;
            case "B":
                short = "Cursor Down Ps Times (default = 1) (CUD).";
                this.activeBuffer.moveCursorRelative({vertical: (param || 1)});
                break;
            case "C":
                short = "Cursor Forward Ps Times (default = 1) (CUF).";

                this.activeBuffer.moveCursorRelative({horizontal: (param || 1)});
                break;
            case "D":
                short = "Cursor Backward Ps Times (default = 1) (CUB).";

                this.activeBuffer.moveCursorRelative({horizontal: -(param || 1)});
                break;
            // CSI Ps E  Cursor Next Line Ps Times (default = 1) (CNL).
            // CSI Ps F  Cursor Preceding Line Ps Times (default = 1) (CPL).
            case "G":
                short = "Cursor Character Absolute [column] (default = [row,1]) (CHA)";
                url = "http://www.vt100.net/docs/vt510-rm/CHA";

                this.activeBuffer.moveCursorAbsolute({columnIndex: or1(param || 1) - 1});
                break;
            case "H":
                short = "Cursor Position [row;column] (default = [1,1]) (CUP).";
                url = "http://www.vt100.net/docs/vt510-rm/CUP";

                this.activeBuffer.moveCursorAbsolute({rowIndex: or1(params[0]) - 1, columnIndex: or1(params[1]) - 1});
                break;
            case "J":
                url = "http://www.vt100.net/docs/vt510-rm/ED";
                switch (param) {
                    case CSI.erase.entire:
                    case CSI.erase.entireSsh:
                        short = "Erase Entire Display (ED).";

                        this.activeBuffer.clear();
                        break;
                    case CSI.erase.toEnd:
                        short = "Erase Display Below (ED).";

                        this.activeBuffer.clearToEnd();
                        break;
                    case CSI.erase.toBeginning:
                        short = "Erase Display Above (ED).";

                        this.activeBuffer.clearToBeginning();
                        break;
                    default:
                        throw `Unknown CSI erase: "${param}".`;
                }
                break;
            case "K":
                url = "http://www.vt100.net/docs/vt510-rm/DECSEL";
                switch (param) {
                    case CSI.erase.entire:
                        short = "Erase the Line (DECSEL).";

                        this.activeBuffer.clearRow();
                        break;
                    case CSI.erase.toEnd:
                        short = "Erase Line to Right (DECSEL).";
                        this.activeBuffer.clearRowToEnd();
                        break;
                    case CSI.erase.toBeginning:
                        short = "Erase Line to Left (DECSEL).";
                        this.activeBuffer.clearRowToBeginning();
                        break;
                    default:
                        throw `Unknown CSI erase: "${param}".`;
                }
                break;
            case "L":
                url = "http://www.vt100.net/docs/vt510-rm/IL";
                short = "Inserts one or more blank lines, starting at the cursor. (DL)";

                this.activeBuffer.scrollDown(param || 1);
                break;
            case "M":
                url = "http://www.vt100.net/docs/vt510-rm/DL";
                short = "Deletes one or more lines in the scrolling region, starting with the line that has the cursor. (DL)";

                this.activeBuffer.scrollUp(param || 1, this.activeBuffer.cursorRowIndex);
                break;
            case "P":
                url = "http://www.vt100.net/docs/vt510-rm/DCH.html";
                short = "Deletes one or more characters from the cursor position to the right.";

                this.activeBuffer.deleteRight(param);
                break;
            case "X":
                short = "Erase P s Character(s) (default = 1) (ECH)";
                url = "http://www.vt100.net/docs/vt510-rm/ECH";

                this.activeBuffer.eraseRight(param || 1);
                break;
            case "c":
                short = "Send Device Attributes (Primary DA)";
                this.terminalDevice.write("\x1b>1;2;");
                break;
            case "d":
                short = "Line Position Absolute [row] (default = [1,column]) (VPA).";
                url = "http://www.vt100.net/docs/vt510-rm/VPA";

                this.activeBuffer.moveCursorAbsolute({rowIndex: or1(param || 1) - 1});
                break;
            case "f":
                short = "Horizontal and Vertical Position [row;column] (default = [1,1]) (HVP).";
                url = "http://www.vt100.net/docs/vt510-rm/HVP";

                this.activeBuffer.moveCursorAbsolute({rowIndex: or1(params[0]) - 1, columnIndex: or1(params[1]) - 1});
                break;
            case "g":
                url = "http://www.vt100.net/docs/vt510-rm/TBC";

                switch (param) {
                    case 0:
                        short = "Clear Tab Stop At Current Column (TBC).";

                        this.activeBuffer.clearTabStop();
                        break;
                    case 3:
                        short = "Clear All Tab Stops (TBC).";

                        this.activeBuffer.clearAllTabStops();
                        break;
                    default:
                        error(`Unknown tab clear parameter "${param}", ignoring.`);
                }
                break;
            case "m":
                short = `SGR: ${params}`;

                if (params.length === 0) {
                    short = "Reset SGR";
                    this.activeBuffer.resetAttributes();
                    break;
                }

                while (params.length !== 0) {
                    const sgr = params.shift()!;

                    if (sgr === 38 || sgr === 48) {
                        const colorFormat = params.shift();

                        if (colorFormat === colorFormatCodes.format8bit) {
                            const color = params.shift();

                            if (color) {
                                this.setColor(sgr, color);
                            } else {
                                error("sgr", sgr, colorFormat, params);
                            }
                        } else if (colorFormat === colorFormatCodes.formatTrueColor) {
                            this.setColor(sgr, params);
                            params = [];
                        } else {
                            error("sgr", sgr, colorFormat, params);
                        }
                    } else {
                        const attributesUpdater = SGR[sgr];

                        if (attributesUpdater) {
                            this.activeBuffer.setAttributes(attributesUpdater(this.activeBuffer.attributes));
                        } else {
                            error("sgr", sgr, params);
                        }
                    }
                }

                break;
            case "n":
                if (param === 6) {
                    url = "http://www.vt100.net/docs/vt510-rm/CPR";
                    short = "Report Cursor Position (CPR) [row;column] as CSI r ; c R";
                    this.terminalDevice.write(csi(`${this.activeBuffer.cursorRowIndex + 1};${this.activeBuffer.cursorColumnIndex + 1}R`));
                } else {
                    status = "unhandled";
                }

                break;
            case "r":
                url = "http://www.vt100.net/docs/vt510-rm/DECSTBM";
                short = "Set Scrolling Region [top;bottom] (default = full size of window) (DECSTBM).";

                const top = <number>(params[0] ? params[0] - 1 : undefined);
                const bottom = <number>(params[1] ? params[1] - 1 : undefined);

                this.activeBuffer.margins = {top: top, bottom: bottom};
                this.activeBuffer.moveCursorAbsolute({rowIndex: 0, columnIndex: 0});
                break;
            case "@":
                url = "http://www.vt100.net/docs/vt510-rm/ICH.html";
                short = "Inserts one or more space (SP) characters starting at the cursor position.";

                this.activeBuffer.insertSpaceRight(param);
                break;
            default:
                status = "unhandled";
        }

        return {
            status: status,
            description: short,
            longDescription: long,
            url: url,
        };
    }

    private setColor(sgr: number, color: ColorCode): void {
        if (sgr === 38) {
            this.activeBuffer.setAttributes({...this.activeBuffer.attributes, color: color});
        } else {
            this.activeBuffer.setAttributes({...this.activeBuffer.attributes, backgroundColor: color});
        }
    }
}


class Buffer {
    public cursorRowIndex = 0;
    public cursorColumnIndex = 0;
    public _showCursor = true;
    public _blinkCursor = true;
    public designatedCharacterSets: DesignatedCharacterSets = {
        G0: CharacterSets.ASCIIGraphics,
        G1: CharacterSets.ASCIIGraphics,
        G2: CharacterSets.ASCIIGraphics,
        G3: CharacterSets.ASCIIGraphics,
    };
    public selectedCharacterSet: SelectedCharacterSet = "G0";
    public isOriginModeSet = false;
    public isAutowrapModeSet = true;
    private scrollback = List<List<Char>>();
    private page = List<List<Char>>();
    private _attributes: i.Attributes = {...defaultAttributes, color: e.Color.White, weight: e.Weight.Normal};
    private _margins: Margins = {top: 0, left: 0};
    private savedState: SavedState | undefined;
    private tabStopIndices = _.range(8, 300, 8);

    constructor(private output: Output, private maxScrollbackSize: number) {
        this.ensureCursorRowExists();
    }

    map<T>(callback: (row: List<Char>, index: number) => T): T[] {
        const result: T[] = [];
        let index = 0;

        this.scrollback.forEach(row => {
            result.push(callback(row!, index));
            ++index;
        });
        this.page.forEach(row => {
            result.push(callback(row!, index));
            ++index;
        });

        return result;
    }

    writeOne(char: string): void {
        const charCode = char.charCodeAt(0);

        /**
         * Is a special symbol.
         * TODO: take into account C1 and DELETE.
         * @link http://www.asciitable.com/index/asciifull.gif
         */
        if (charCode < 32) {
            switch (charCode) {
                case e.KeyCode.Bell:
                    break;
                case e.KeyCode.Backspace:
                    this.moveCursorRelative({horizontal: -1});
                    break;
                case e.KeyCode.Tab:
                    this.moveCursorAbsolute({columnIndex: this.nextTabStopIndex});
                    break;
                case e.KeyCode.NewLine:
                case e.KeyCode.VerticalTab:
                    if (this.cursorRowIndex === this._margins.bottom) {
                        this.scrollUp(1);
                    } else {
                        this.moveCursorRelative({vertical: 1});
                    }

                    break;
                case e.KeyCode.CarriageReturn:
                    this.moveCursorAbsolute({columnIndex: 0});
                    break;
                case e.KeyCode.ShiftIn:
                    this.selectedCharacterSet = "G0";
                    break;
                case e.KeyCode.ShiftOut:
                    this.selectedCharacterSet = "G1";
                    break;
                default:
                    error(`Couldn't write a special char with code ${charCode}.`);
            }
        } else {

            const charFromCharset = this.charFromCharset(char);
            const charObject = createChar(charFromCharset, this.attributes);

            if (this.cursorColumnIndex === this.dimensions.columns) {
                if (this.isAutowrapModeSet) {
                    this.moveCursorAbsolute({columnIndex: 0});
                    this.moveCursorRelative({vertical: 1});
                } else {
                    this.moveCursorRelative({horizontal: -1});
                }
            }

            this.set(charObject);
            this.moveCursorRelative({horizontal: 1});
        }
    }

    scrollDown(count: number) {
        times(count, () => this.page = this.page.delete(this.marginBottom));
        times(count, () => this.page = this.page.insert(this.cursorRowIndex, this.emptyLine));
    }

    scrollUp(count: number, deletedLine = this._margins.top) {
        times(count, () => this.page = this.page.splice((this._margins.bottom || 0) + 1, 0, this.emptyLine).toList());
        this.page = this.page.splice(deletedLine, count).toList();
    }

    get attributes(): i.Attributes {
        return this._attributes;
    }

    resetAttributes(): void {
        this._attributes = defaultAttributes;
    }

    setAttributes(attributes: i.Attributes): void {
        this._attributes = attributesFlyweight({...this._attributes, ...attributes});
    }

    toLines(): string[] {
        return this.map(row => row.map(char => char!.value).join(""));
    }

    showCursor(state: boolean): void {
        this._showCursor = state;
    }

    blinkCursor(state: boolean): void {
        this._blinkCursor = state;
    }

    moveCursorRelative(advancement: Advancement): this {
        const unboundRowIndex = this.cursorRowIndex + (advancement.vertical || 0);
        const boundRowIndex = this._margins.bottom ? Math.min(this.marginBottom, unboundRowIndex) : unboundRowIndex;

        // Cursor might be hanging after the last column.
        const boundColumnIndex = Math.min(this.lastColumnIndex, this.cursorColumnIndex);


        this.cursorRowIndex = Math.max(0, boundRowIndex);
        this.cursorColumnIndex = Math.min(this.dimensions.columns, Math.max(0, boundColumnIndex + (advancement.horizontal || 0)));

        this.ensureCursorRowExists();
        return this;
    }

    moveCursorAbsolute(position: Partial<RowColumn>): this {
        if (typeof position.columnIndex === "number") {
            this.cursorColumnIndex = Math.max(position.columnIndex, 0) + this.homePosition.columnIndex;
        }

        if (typeof position.rowIndex === "number") {

            this.cursorRowIndex = Math.max(position.rowIndex, 0) + this.homePosition.rowIndex;
        }

        this.ensureCursorRowExists();
        return this;
    }

    deleteRight(n: number) {
        this.page = this.page.update(
            this.cursorRowIndex,
            row => row.splice(this.cursorColumnIndex, n).concat(this.spaces(n)).toList(),
        );
    }

    insertSpaceRight(n: number) {
        this.page = this.page.update(
            this.cursorRowIndex,
            row => row.splice(this.cursorColumnIndex, 0, this.spaces(n)).toList(),
        );
    }

    eraseRight(n: number) {
        this.page = this.page.update(
            this.cursorRowIndex,
            row => row.take(this.cursorColumnIndex)
                .concat(this.spaces(n), row.skip(this.cursorColumnIndex + n))
                .toList(),
        );
    }

    clearRow() {
        this.page = this.page.set(this.cursorRowIndex, this.emptyLine);
    }

    clearRowToEnd() {
        const oldRow = this.page.get(this.cursorRowIndex);
        const newHead = oldRow.splice(this.cursorColumnIndex, this.lastColumnIndex);
        const newTail = this.spaces(this.dimensions.columns - this.cursorColumnIndex);
        const newRow = newHead.concat(newTail).toList();

        this.page = this.page.set(this.cursorRowIndex, newRow);
    }

    clearRowToBeginning() {
        const count = this.cursorColumnIndex + 1;
        this.page = this.page.update(
            this.cursorRowIndex,
            row => this.spaces(count).concat(row.skip(count)).toList());
    }

    clear() {
        this.page = List<List<Char>>();
        this.moveCursorAbsolute({rowIndex: 0, columnIndex: 0});
    }

    clearToBeginning() {
        this.clearRowToBeginning();
        const replacement = Array(this.cursorRowIndex).fill(this.emptyLine);

        this.page = this.page.splice(0, this.cursorRowIndex, ...replacement).toList();
    }

    clearToEnd() {
        this.clearRowToEnd();
        this.page = this.page.splice(this.cursorRowIndex + 1, this.size - this.cursorRowIndex).toList();
    }

    get scrollbackSize(): number {
        return this.scrollback.size;
    }

    get size(): number {
        return this.page.size;
    }

    set margins(margins: Partial<Margins>) {
        this._margins = {...this._margins, ...margins};
    }

    get marginTop(): number {
        return this._margins.top;
    }

    get marginBottom(): number {
        if (this._margins.bottom) {
            return this._margins.bottom;
        } else {
            return this.dimensions.rows - 1;
        }
    }

    at(position: RowColumn): Char {
        return this.page.getIn([position.rowIndex, position.columnIndex]);
    }

    saveCurrentState() {
        this.savedState = {
            cursorRowIndex: this.cursorRowIndex,
            cursorColumnIndex: this.cursorColumnIndex,
            attributes: {...this.attributes},
            designatedCharacterSets: {...this.designatedCharacterSets},
            selectedCharacterSet: this.selectedCharacterSet,
        };
    }

    restoreCurrentState() {
        if (this.savedState) {
            this.moveCursorAbsolute({rowIndex: this.savedState.cursorRowIndex, columnIndex: this.savedState.cursorColumnIndex});
            this.setAttributes(this.savedState.attributes);
            this.selectedCharacterSet = this.savedState.selectedCharacterSet;
            this.designatedCharacterSets = this.savedState.designatedCharacterSets;
        } else {
            console.error("No state to restore.");
        }
    }

    setTabStop() {
        this.tabStopIndices = _.sortBy(_.union(this.tabStopIndices, [this.cursorColumnIndex]));
    }

    clearTabStop() {
        this.tabStopIndices = _.without(this.tabStopIndices, this.cursorColumnIndex);
    }

    clearAllTabStops() {
        this.tabStopIndices = [];
    }

    get nextTabStopIndex() {
        const unboundTabStopIndex = this.tabStopIndices.find(index => index > this.cursorColumnIndex) || this.cursorColumnIndex;
        return Math.min(unboundTabStopIndex, this.lastColumnIndex);
    }

    private get homePosition(): RowColumn {
        if (this.isOriginModeSet) {
            return {rowIndex: this._margins.top || 0, columnIndex: this._margins.left || 0};
        } else {
            return {rowIndex: 0, columnIndex: 0};
        }
    }

    private set(char: Char): void {
        this.ensureCursorRowExists();
        this.page = this.page.setIn([this.cursorRowIndex, this.cursorColumnIndex], char);
    }

    private ensureCursorRowExists(): void {
        for (let index = this.cursorRowIndex; index >= 0; --index) {
            if (!this.page.get(index)) {
                this.page = this.page.set(index, this.emptyLine);
            } else {
                break;
            }
        }

        if (this.size > this.dimensions.rows) {
            const newStorage = this.page.takeLast(this.dimensions.rows).toList();
            const rowsToMoveToScrollback = this.page.skipLast(this.dimensions.rows).toList();
            this.scrollback = this.scrollback.concat(rowsToMoveToScrollback).takeLast(this.maxScrollbackSize).toList();

            this.page = newStorage;
            this.cursorRowIndex = this.size - 1;
        }
    }

    private charFromCharset(char: string) {
        if (this.designatedCharacterSets[this.selectedCharacterSet] === CharacterSets.ASCIIGraphics) {
            return char;
        } else {
            return graphicCharset[char] || char;
        }
    }

    private get lastColumnIndex() {
        return this.dimensions.columns - 1;
    }

    private get emptyLine() {
        return this.spaces(this.dimensions.columns);
    }

    private spaces(n: number) {
        return List.of(...Array(n).fill(createChar(" ", this.attributes)));
    }

    get dimensions() {
        return this.output.dimensions;
    }
}
