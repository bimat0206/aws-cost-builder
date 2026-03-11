/**
 * HCL Parser — converts an HCL v7.0 DSL string to a plain ProfileDocument object.
 *
 * v7.0 grammar:
 *   schema_version = "7.0"
 *   project_name   = "..."
 *
 *   group "name" {
 *     label = "..."
 *
 *     service "Amazon S3" "amazon_s3" {
 *       region      = "us-east-1"
 *       human_label = "Amazon S3"
 *
 *       # top-level flat attributes (ungrouped fields)
 *       description = "..."
 *
 *       # named section (non-toggle sub-panel)
 *       section "S3 Standard" {
 *         storage      = 500
 *         storage_unit = "GB per month"
 *
 *         section "Nested" { ... }  # recursive
 *       }
 *
 *       # toggle-gated feature
 *       feature "S3 Standard" {
 *         section "S3 Standard" {
 *           storage      = 500
 *           storage_unit = "GB per month"
 *         }
 *       }
 *     }
 *
 *     group "nested" { ... }
 *   }
 *
 * @module hcl/parser
 */

const TK = {
    IDENT:  'IDENT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOL:   'BOOL',
    NULL:   'NULL',
    EQ:     'EQ',
    LBRACE: 'LBRACE',
    RBRACE: 'RBRACE',
    EOF:    'EOF',
};

function slugifyName(value, fallback = 'group') {
    const slug = String(value ?? '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return slug || fallback;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

function isAlpha(ch)    { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'; }
function isAlphaNum(ch) { return isAlpha(ch) || (ch >= '0' && ch <= '9'); }

function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;

    while (i < src.length) {
        const ch = src[i];

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

        // Strings
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
            i++;
            tokens.push({ type: TK.STRING, value: str, line });
            continue;
        }

        if (ch === '=') { tokens.push({ type: TK.EQ,     value: '=', line }); i++; continue; }
        if (ch === '{') { tokens.push({ type: TK.LBRACE, value: '{', line }); i++; continue; }
        if (ch === '}') { tokens.push({ type: TK.RBRACE, value: '}', line }); i++; continue; }

        // Numbers (including negatives)
        if ((ch >= '0' && ch <= '9') || (ch === '-' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
            let num = ch; i++;
            while (i < src.length && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) {
                num += src[i++];
            }
            tokens.push({ type: TK.NUMBER, value: Number(num), line });
            continue;
        }

        // Identifiers / keywords
        if (isAlpha(ch)) {
            let word = '';
            while (i < src.length && isAlphaNum(src[i])) word += src[i++];
            if (word === 'true')  { tokens.push({ type: TK.BOOL, value: true,  line }); continue; }
            if (word === 'false') { tokens.push({ type: TK.BOOL, value: false, line }); continue; }
            if (word === 'null')  { tokens.push({ type: TK.NULL, value: null,  line }); continue; }
            tokens.push({ type: TK.IDENT, value: word, line });
            continue;
        }

        throw new SyntaxError(`Unexpected character '${ch}' at line ${line}`);
    }

    tokens.push({ type: TK.EOF, value: null, line });
    return tokens;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos    = 0;
    }

    peek()    { return this.tokens[this.pos]; }
    advance() { return this.tokens[this.pos++]; }

    expect(type) {
        const tok = this.advance();
        if (tok.type !== type) {
            throw new SyntaxError(
                `Expected token ${type} but got ${tok.type} (${JSON.stringify(tok.value)}) at line ${tok.line}`
            );
        }
        return tok;
    }

    expectValue(value) {
        const tok = this.advance();
        if (tok.value !== value) {
            throw new SyntaxError(
                `Expected ${JSON.stringify(value)} but got ${JSON.stringify(tok.value)} at line ${tok.line}`
            );
        }
        return tok;
    }

    isIdent(value) {
        const tok = this.peek();
        return tok.type === TK.IDENT && tok.value === value;
    }

    isAtRBrace() { return this.peek().type === TK.RBRACE; }
    isAtEOF()    { return this.peek().type === TK.EOF; }

    parseValue() {
        const tok = this.peek();
        if ([TK.STRING, TK.NUMBER, TK.BOOL, TK.NULL].includes(tok.type)) {
            this.advance();
            return tok.value;
        }
        throw new SyntaxError(`Expected literal value at line ${tok.line}`);
    }

    /** Skip an unknown ident = value pair (forward compat). */
    skipUnknown() {
        this.advance(); // ident
        if (this.peek().type === TK.EQ) {
            this.advance();
            this.parseValue();
        }
    }

    /**
     * Parse a block of flat attributes + nested blocks.
     * Returns { attrs: { key: value }, subBlocks: [...] }
     *
     * @param {function} blockParsers - map of keyword → parser function
     */
    parseBlock(blockParsers = {}) {
        this.expect(TK.LBRACE);
        const attrs     = {};
        const subBlocks = [];

        while (!this.isAtRBrace()) {
            const tok = this.peek();

            if (tok.type === TK.IDENT && blockParsers[tok.value]) {
                subBlocks.push(blockParsers[tok.value]());

            } else if (tok.type === TK.IDENT) {
                const key = this.advance().value;
                if (this.peek().type === TK.EQ) {
                    this.advance();
                    attrs[key] = this.parseValue();
                } else if (this.peek().type === TK.LBRACE) {
                    this.skipBlock();
                }
            } else if (tok.type === TK.STRING && this.tokens[this.pos + 1]?.type === TK.EQ) {
                const key = this.advance().value;
                this.advance();
                attrs[key] = this.parseValue();
            } else {
                this.skipUnknown();
            }
        }

        this.expect(TK.RBRACE);
        return { attrs, subBlocks };
    }

    skipBlock() {
        this.expect(TK.LBRACE);
        let depth = 1;
        while (!this.isAtEOF() && depth > 0) {
            const t = this.advance();
            if (t.type === TK.LBRACE) depth++;
            if (t.type === TK.RBRACE) depth--;
        }
    }

    // ── section "Name" { attrs + nested section blocks } ─────────────────────

    parseSection() {
        this.expectValue('section');
        const nameTok = this.expect(TK.STRING);
        const label = nameTok.value;

        const group = {
            group_name: slugifyName(label, 'section'),
            label,
            fields: {},
            groups: [],
        };

        const { attrs, subBlocks } = this.parseBlock({
            section: () => this.parseSection(),
        });

        // Each flat attr becomes a synthetic "field" in group.fields
        for (const [key, value] of Object.entries(attrs)) {
            if (key.endsWith('_unit')) {
                // Pair with base field
                const baseKey = key.slice(0, -5); // strip "_unit"
                if (group.fields[baseKey]) {
                    group.fields[baseKey].unit = value;
                } else {
                    // Unit arrived before base — store temporarily
                    group.fields[key] = { key, user_value: value, default_value: null };
                }
            } else {
                group.fields[key] = {
                    key,
                    user_value:    value,
                    default_value: null,
                    field_type:    null,
                    unit:          null,
                };
            }
        }

        // Reconcile units that arrived before their base key
        for (const [key] of Object.entries(group.fields)) {
            if (key.endsWith('_unit')) {
                const baseKey = key.slice(0, -5);
                if (group.fields[baseKey]) {
                    group.fields[baseKey].unit = group.fields[key].user_value;
                    delete group.fields[key];
                }
            }
        }

        group.groups = subBlocks;
        if (group.groups.length === 0) delete group.groups;
        return group;
    }

    // ── feature "Name" { section blocks + direct attrs } ─────────────────────
    //   Maps to a config_group with label "Name feature" so the serializer
    //   can identify it as a feature block.

    parseFeature() {
        this.expectValue('feature');
        const nameTok = this.expect(TK.STRING);
        const label = nameTok.value;

        const group = {
            group_name: slugifyName(`${label}_feature`, 'feature'),
            label:      `${label} feature`,  // keep " feature" suffix for roundtrip
            fields:     {},
            groups:     [],
        };

        const { attrs, subBlocks } = this.parseBlock({
            section: () => this.parseSection(),
        });

        // Direct attrs inside feature (if any) become top-level fields on the feature group
        for (const [key, value] of Object.entries(attrs)) {
            group.fields[key] = { key, user_value: value, default_value: null, field_type: null, unit: null };
        }

        group.groups = subBlocks;
        if (group.groups.length === 0) delete group.groups;
        return group;
    }

    // ── service "Name" "slug" { ... } ─────────────────────────────────────────

    parseService() {
        this.expectValue('service');
        const serviceNameTok = this.expect(TK.STRING);
        const slugTok        = this.expect(TK.STRING);
        this.expect(TK.LBRACE);

        const service = {
            service_name:  serviceNameTok.value,
            human_label:   slugTok.value,
            region:        'us-east-1',
            config_groups: [],
        };

        const ensureGeneral = () => {
            let g = service.config_groups.find(cg => cg.group_name === 'general');
            if (!g) {
                g = { group_name: 'general', label: null, fields: {}, groups: [] };
                service.config_groups.unshift(g);
            }
            return g;
        };

        while (!this.isAtRBrace()) {
            const tok = this.peek();

            if (tok.type === TK.IDENT && tok.value === 'section') {
                service.config_groups.push(this.parseSection());

            } else if (tok.type === TK.IDENT && tok.value === 'feature') {
                service.config_groups.push(this.parseFeature());

            } else if (tok.type === TK.IDENT && tok.value === 'region') {
                this.advance(); this.expect(TK.EQ);
                service.region = this.parseValue();

            } else if (tok.type === TK.IDENT && tok.value === 'human_label') {
                this.advance(); this.expect(TK.EQ);
                service.human_label = this.parseValue();

            } else if (tok.type === TK.IDENT || (tok.type === TK.STRING && this.tokens[this.pos + 1]?.type === TK.EQ)) {
                const key = this.advance().value;
                if (this.peek().type === TK.EQ) {
                    this.advance();
                    const value = this.parseValue();
                    const g = ensureGeneral();

                    if (key.endsWith('_unit')) {
                        const baseKey = key.slice(0, -5);
                        if (g.fields[baseKey]) {
                            g.fields[baseKey].unit = value;
                        } else {
                            g.fields[key] = { key, user_value: value, default_value: null };
                        }
                    } else {
                        g.fields[key] = { key, user_value: value, default_value: null, field_type: null, unit: null };
                    }
                }
            } else {
                this.skipUnknown();
            }
        }

        this.expect(TK.RBRACE);
        return service;
    }

    // ── group "name" { label = ...; service ...; group ...; } ─────────────────

    parseGroup() {
        this.expectValue('group');
        const nameTok = this.expect(TK.STRING);
        this.expect(TK.LBRACE);

        const group = {
            group_name: nameTok.value,
            label:      null,
            services:   [],
            groups:     [],
        };

        while (!this.isAtRBrace()) {
            const tok = this.peek();
            if (tok.type === TK.IDENT && tok.value === 'label') {
                this.advance(); this.expect(TK.EQ);
                group.label = this.parseValue();
            } else if (tok.type === TK.IDENT && tok.value === 'service') {
                group.services.push(this.parseService());
            } else if (tok.type === TK.IDENT && tok.value === 'group') {
                group.groups.push(this.parseGroup());
            } else {
                this.skipUnknown();
            }
        }

        this.expect(TK.RBRACE);
        if (!group.label)          delete group.label;
        if (!group.groups.length)  delete group.groups;
        return group;
    }

    // ── Root ──────────────────────────────────────────────────────────────────

    parseProfile() {
        const profile = {
            schema_version: '7.0',
            project_name:   'unnamed',
            description:    null,
            groups:         [],
        };

        while (!this.isAtEOF()) {
            if (this.isIdent('schema_version')) {
                this.advance(); this.expect(TK.EQ);
                profile.schema_version = this.parseValue();
            } else if (this.isIdent('project_name')) {
                this.advance(); this.expect(TK.EQ);
                profile.project_name = this.parseValue();
            } else if (this.isIdent('description')) {
                this.advance(); this.expect(TK.EQ);
                profile.description = this.parseValue();
            } else if (this.isIdent('group')) {
                profile.groups.push(this.parseGroup());
            } else {
                this.skipUnknown();
            }
        }

        return profile;
    }
}

/**
 * Parse an HCL v7.0 string into a plain profile object.
 * @param {string} src
 * @returns {object}
 */
export function parseHCL(src) {
    const tokens = tokenize(src);
    const parser = new Parser(tokens);
    return parser.parseProfile();
}
