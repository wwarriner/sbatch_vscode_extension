"use strict";
import * as vscode from "vscode";
import * as path from "path";
import * as flags from "./flags.json";
import * as validators from "./validators.json";

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("test");
  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document, collection);
  }
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event) {
        updateDiagnostics(event.textEditor.document, collection);
      }
    })
  );
}

function updateDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  if (document && path.extname(document.uri.fsPath) === ".sh") {
    // create two flag maps, long and short, by splitting each element into two
    // elements, using each as keys, and adding to new map
    // 1) "long_map": "key" = {other stuff}
    // 2) "short_map": "key" = {other stuff}
    const long_flags: { [index: string]: any } = {};
    for (const key in flags) {
      const in_value = flags[key];
      const long = in_value.long;
      const short = in_value.short;
      if (long !== null) {
        let value = JSON.parse(JSON.stringify(in_value));
        delete value.long;
        delete value.short;
        long_flags[long] = {};
        Object.assign(long_flags[long], value);
        long_flags["short"] = short;
      }
    }

    const short_flags: { [index: string]: any } = {};
    for (const key in flags) {
      const in_value = flags[key];
      const long = in_value.long;
      const short = in_value.short;
      if (short !== null) {
        let value = JSON.parse(JSON.stringify(in_value));
        delete value.long;
        delete value.short;
        short_flags[short] = {};
        Object.assign(short_flags[short], value);
        long_flags["long"] = long;
      }
    }
    // inject non-regexable validator functions into validators??

    // for each line in document
    //  if line begins with "#SBATCH"
    //   break up the line into components
    //   <#SBATCH>< ><--><flag>(<=><value> optional)
    //   if flag is not in flag map, emit error that this line will be treated as a comment
    //   if flag is in flag map
    //    check that value matches the allowed values
    //   if not add to diagnostics with reasoning
    const diagnostics = [];
    for (var line_index = 0; line_index < document.lineCount; line_index += 1) {
      const line = document.lineAt(line_index);
      if (line.isEmptyOrWhitespace) {
        continue;
      }

      /*
      REGEX for SBATCH flag lines
      1. literal #SBATCH
      2. literal space character ( )
      3. literal dash (-) or double dash (--)
      4. flag: any number of characters except literal equals [=]
      5. OPTIONAL:
        1. literal equals (=)
        2. values: any number of characters
      */
      const regex = /(^(?<tag>#SBATCH|)(?<space> |)(?<dashes>-{1,2}|)(?<flag>[^= ]*|)(?:(?<equals>[= ]|)(?<values>.*|))$)/;
      const matches = line.text.match(regex);
      if (matches === null || !("groups" in matches)) {
        continue;
      }

      const groups = matches.groups!;
      if (groups.tag === "") {
        continue;
      }

      /*
      TODO
      if tag is missing, ignore

      TODO if flag is present AND space missing, add space
      TODO if flag is present AND dash(es) missing, add dash(es)

      if flag is missing, error: missing flag
      */

      if (groups.flag === "") {
        diagnostics.push({
          message:
            "SBATCH flag is missing. Format should be one of the following:\n" +
            "  #SBATCH -<short_flag>[=values]\n" +
            "  #SBATCH --<long_flag>[=values]",
          range: line.range,
          severity: vscode.DiagnosticSeverity.Error,
        });
        continue;
      }

      let start = line.range.start.translate(0, groups.tag.length);
      let len = Math.max(groups.space.length, 1);
      let end = start.translate(0, len);
      if (groups.space === "") {
        // TODO auto-create space
        diagnostics.push({
          message: "space missing after #SBATCH",
          range: new vscode.Range(start, end),
          severity: vscode.DiagnosticSeverity.Error,
        });
      }
      start = end;

      len = Math.max(groups.dashes.length, 1);
      end = start.translate(0, len);
      if (groups.dashes === "") {
        // TODO auto-format dashes based on flag
        diagnostics.push({
          message: "dashes missing on flag",
          range: new vscode.Range(start.translate(0, -1), end.translate(0, -1)),
          severity: vscode.DiagnosticSeverity.Error,
        });
      }
      start = end;

      // TODO auto-format dashes based on flag
      len = Math.max(groups.flag.length, 1);
      end = start.translate(0, len);
      if (!(groups.flag in short_flags || groups.flag in long_flags)) {
        diagnostics.push({
          message: "unrecognized flag: " + groups.flag,
          range: new vscode.Range(start, end),
          severity: vscode.DiagnosticSeverity.Error,
        });
        continue;
      }

      if (groups.dashes === "-" && !(groups.flag in short_flags)) {
        diagnostics.push({
          message: "-- required for long flag: " + groups.flag,
          range: new vscode.Range(start.translate(0, -1), end),
          severity: vscode.DiagnosticSeverity.Error,
        });
      }
      if (groups.dashes === "--" && !(groups.flag in long_flags)) {
        diagnostics.push({
          message: "- required for short flag: " + groups.flag,
          range: new vscode.Range(start.translate(0, -2), end),
          severity: vscode.DiagnosticSeverity.Error,
        });
      }
      start = end;

      let value = null;
      if (groups.flag in long_flags) {
        value = long_flags[groups.flag];
      } else {
        value = short_flags[groups.flag];
      }

      // recursive value checking here

      // TODO validate values here
    }
    collection.set(document.uri, diagnostics);

    // fn: recursive value checking
    //  expand literals to literal: string
    //  get the values key of the flag map node
    //   string? validate by validators map lookup
    //   null? validate that value is empty
    //   one_of? for loop recursion over children, exactly one must be TRUE
    //   any_of? for loop recursion over children, at least one must be TRUE
    //   object?
    //    list? for loop over comma-split on value
    //    literal? value === string

    // fn: literal expansion
    //  recursively loop over all children
    //   string? replace by object {"literal": string}
    //   otherwise? skip
  } else {
    collection.clear();
  }
}

// TODO
// number_list: 1,2,4-6
// and_or_word_list: [[:word:]]|[[:word:]]&[[:word:]]
// time: MMDDYY or MM/DD/YY or YYYY-MM-DD or YYYY-MM-DD[THH:MM[:SS]]
// time_units: seconds, minutes, hours, days, weeks
// string: no quotes -> no spaces, otherwise anything, warn on unmatched quote
// delay: now+[integer][time_units]
