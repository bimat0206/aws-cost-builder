/**
 * HCL Parser — converts an HCL DSL string to a plain ProfileDocument object.
 * @module hcl/parser
 *
 * Hand-written recursive descent parser. No external dependencies.
 *
 * Grammar (simplified):
 *   file         := assignment* group*
 *   assignment   := IDENT "=" value
 *   group        := "group" STRING "{" (label_stmt | group | service)* "}"
 *   label_stmt   := "label" "=" STRING
 *   service      := "service" STRING STRING "{" (region_stmt | human_label_stmt | dimension | section)* "}"
 *   section      := "section" STRING "{" dimension* "}"
 *   dimension    := "dimension" STRING padding? "=" value
 *   value        := STRING | NUMBER | BOOL | "null"
 */

// ─── Tokeniser ────────────────────────────────────────────────────────────────

const TK = {
    IDENT: 'IDENT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOL: 'BOOL',
    NULL: 'NULL',
    EQ: 'EQ',
    LBRACE: 'LBRACE',
    RBRACE: 'RBRACE',
    EOF: 'EOF',
};

/**
 * Tokenise an HCL source string.
 * @param {string} src
 * @returns {Array<{type: string, value: *, line: number}>}
 */
function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;

    while (i < src.length) {
        const ch = src[i];

        // Whitespace
        if (ch === '\n') { line++; i++; continue; }
        if (ch === '\r' || ch === '\t' || ch === ' ') { i++; continue; }

        // Line comments
        if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }

        // Block comments
        if (ch === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') line++;
                i++;
            }
            i += 2;
            continue;
        }

        // Quoted string
        if (ch === '"') {
            let str = '';
            i++;
            while (i < src.length && src[i] !== '"') {
                if (src[i] === '\\') {
                    i++;
                    switch (src[i]) {
                        case 'n':  str += '\n'; break;
                        case 't':  str += '\t'; break;
                        case 'r':  str += '\r'; break;
                        case '"':  str += '"';  break;
                        case '\\': str += '\\'; break;
                        default:   str += src[i]; break;
                    }
                } else {
                    if (src[i] === '\n') line++;
                    str += src[i];
                }
                i++;
            }
            i++; // closing quote
            tokens.push({ type: TK.STRING, value: str, line });
            continue;
        }

        // Equals
        if (ch === '=') { tokens.push({ type: TK.EQ, value: '=', line }); i++; continue; }

        // Braces
        if (ch === '{') { tokens.push({ type: TK.LBRACE, value: '{', line }); i++; continue; }
        if (ch === '}') { tokens.push({ type: TK.RBRACE, value: '}', line }); i++; continue; }

        // Number (optional leading minus)
        if ((ch >= '0' && ch <= '9') || (ch === '-' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
            let num = ch;
            i++;
            while (i < src.length && (src[i] >= '0' && src[i] <= '9' || src[i] === '.')) {
                num += src[i++];
            }
            tokens.push({ type: TK.NUMBER, value: Number(num), line });
            continue;
        }

        // Identifier / keyword
        if (isAlpha(ch)) {
            let word = '';
            while (i < src.length && isAlphaNum(src[i])) {
                word += src[i++];
            }
            if (word === 'true')  { tokens.push({ type: TK.BOOL, value: true, line }); continue; }
            if (word === 'false') { tokens.push({ type: TK.BOOL, value: false, line }); continue; }
            if (word === 'null')  { tokens.push({ type: TK.NULL, value: null, line }); continue; }
            tokens.push({ type: TK.IDENT, value: word, line });
            continue;
        }

        throw new SyntaxError(`Unexpected character '${ch}' at line ${line}`);
    }

    tokens.push({ type: TK.EOF, value: null, line });
    return tokens;
}

function isAlpha(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
function isAlphaNum(ch) {
    return isAlpha(ch) || (ch >= '0' && ch <= '9');
}

// ─── Parser ───────────────────────────────────────────────────────────────────

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek() { return this.tokens[this.pos]; }
    advance() { return this.tokens[this.pos++]; }

    expect(type) {
        const tok = this.advance();
        if (tok.type !== type) {
            throw new SyntaxError(`Expected ${type} but got ${tok.type} (${JSON.stringify(tok.value)}) at line ${tok.line}`);
    }
        return tok;
    }

    expectValue(value) {
        const tok = this.advance();
        if (tok.value !== value) {
            throw new SyntaxError(`Expected ${JSON.stringify(value)} but got ${JSON.stringify(tok.value)} at line ${tok.line}`);
        }
        return tok;
    }

    isIdent(value) {
        const tok = this.peek();
        return tok.type === TK.IDENT && tok.value === value;
    }

    /**
     * Parse a scalar value: string, number, bool, or null.
     */
    parseValue() {
        const tok = this.peek();
        if (tok.type === TK.STRING || tok.type === TK.NUMBER || tok.type === TK.BOOL || tok.type === TK.NULL) {
            this.advance();
            return tok.value;
        }
        throw new SyntaxError(`Expected a value (string, number, bool, null) at line ${tok.line}`);
    }

    /**
     * Parse a dimension statement:
     *   dimension "Key Name" = value
     * Returns { key, value }
     */
    parseDimension() {
        this.expectValue('dimension');
        const keyTok = this.expect(TK.STRING);
        this.expect(TK.EQ);
        const value = this.parseValue();
        return { key: keyTok.value, value };
    }

    /**
     * Parse a section block inside a service:
     *   section "Section Name" {
     *       dimension "..." = ...
     *   }
     * Returns { section_name, dimensions }
     */
    parseSection() {
        this.expectValue('section');
        const nameTok = this.expect(TK.STRING);
        this.expect(TK.LBRACE);
        const section = { section_name: nameTok.value, dimensions: {} };

        while (!this.isAtRBrace()) {
            const tok = this.peek();
            if (tok.type === TK.IDENT && tok.value === 'dimension') {
                const { key, value } = this.parseDimension();
                section.dimensions[key] = {
                    user_value: value,
                    default_value: null,
                };
            } else {
                // skip unknown or assignments inside section
                this.advance();
                if (this.peek().type === TK.EQ) {
                    this.advance();
                    this.parseValue();
                }
            }
        }

        this.expect(TK.RBRACE);
        return section;
    }

    /**
     * Parse a service block:
     *   service "service_name" "slug" {
     *     region      = "..."
     *     human_label = "..."
     *     dimension "..." = ...
     *   }
     */
    parseService() {
        this.expectValue('service');
        const serviceNameTok = this.expect(TK.STRING);
        const slugTok = this.expect(TK.STRING);
        this.expect(TK.LBRACE);

        const service = {
            service_name: serviceNameTok.value,
            human_label: slugTok.value,
            region: 'global',
            dimensions: {},
            sections: [],
        };

        while (!this.isAtRBrace()) {
            const tok = this.peek();
            if (tok.type === TK.IDENT && tok.value === 'dimension') {
                const { key, value } = this.parseDimension();
                service.dimensions[key] = {
                    user_value: value,
                    default_value: null,
                };
            } else if (tok.type === TK.IDENT && tok.value === 'region') {
                this.advance();
                this.expect(TK.EQ);
                service.region = this.parseValue();
            } else if (tok.type === TK.IDENT && tok.value === 'human_label') {
                this.advance();
                this.expect(TK.EQ);
                service.human_label = this.parseValue();
            } else if (tok.type === TK.IDENT && tok.value === 'section') {
                const sec = this.parseSection();
                if (sec) service.sections.push(sec);
            } else {
                // Unknown statement — skip
                this.advance();
                if (this.peek().type === TK.EQ) {
                    this.advance();
                    this.parseValue();
                }
            }
        }

        this.expect(TK.RBRACE);
        return service;
    }

    /**
     * Parse a group block (recursively handles nested groups):
     *   group "name" {
     *     label = "..."
     *     group "child" { ... }
     *     service "..." "..." { ... }
     *   }
     */
    parseGroup() {
        this.expectValue('group');
        const nameTok = this.expect(TK.STRING);
        this.expect(TK.LBRACE);

        const group = {
            group_name: nameTok.value,
            label: null,
            services: [],
            groups: [],
        };

        while (!this.isAtRBrace()) {
            const tok = this.peek();
            if (tok.type === TK.IDENT && tok.value === 'label') {
                this.advance();
                this.expect(TK.EQ);
                group.label = this.parseValue();
            } else if (tok.type === TK.IDENT && tok.value === 'group') {
                group.groups.push(this.parseGroup());
            } else if (tok.type === TK.IDENT && tok.value === 'service') {
                group.services.push(this.parseService());
            } else {
                // Unknown — skip assignment
                this.advance();
                if (this.peek().type === TK.EQ) {
                    this.advance();
                    this.parseValue();
                }
            }
        }

        this.expect(TK.RBRACE);

        // Clean up empty arrays / null label
        if (group.groups.length === 0) delete group.groups;
        if (group.label === null) delete group.label;

        return group;
    }

    isAtRBrace() {
        return this.peek().type === TK.RBRACE || this.peek().type === TK.EOF;
    }

    /**
     * Parse the entire HCL file.
     * @returns {object} plain ProfileDocument-compatible object
     */
    parseFile() {
        const profile = {
            schema_version: '3.0',
            project_name: '',
            description: null,
            groups: [],
        };

        while (this.peek().type !== TK.EOF) {
            const tok = this.peek();

            if (tok.type === TK.IDENT && tok.value === 'group') {
                profile.groups.push(this.parseGroup());
            } else if (tok.type === TK.IDENT) {
                const key = this.advance().value;
                this.expect(TK.EQ);
                const value = this.parseValue();
                if (Object.prototype.hasOwnProperty.call(profile, key)) {
                    profile[key] = value;
                }
            } else {
                throw new SyntaxError(`Unexpected token ${tok.type} at line ${tok.line}`);
            }
        }

        return profile;
    }
}

/**
 * Parse an HCL profile string into a plain ProfileDocument-compatible object.
 * @param {string} src - HCL source text
 * @returns {object} plain object compatible with ProfileDocument.fromObject()
 * @throws {SyntaxError} on parse errors
 */
export function parseHCL(src) {
    const tokens = tokenize(src);
    const parser = new Parser(tokens);
    return parser.parseFile();
}
