const vscode = require("vscode");
const debug = vscode.window.createOutputChannel("Greyscript Debugging")

var CompData = require("./grammar/CompletionData.json")
var TypeData = require("./grammar/TypeData.json")
var ArgData = require("./grammar/ArgData.json")
var ReturnData = require("./grammar/ReturnData.json")
var Examples = require("./grammar/Examples.json")
var CompTypes = require("./grammar/CompletionTypes.json") // Constant 20 Function 2 Property 9 Method 1 Variable 5 Interface 7
var HoverData = require("./grammar/HoverData.json");
var Encryption = require("./grammar/Encryption.json");

function activate(context) {
    let hoverD = vscode.languages.registerHoverProvider('greyscript', {
        provideHover(document,position,token) {
            if (!vscode.workspace.getConfiguration("greyscript").get("hoverdocs")) return;
            let range = document.getWordRangeAtPosition(position)
            let word = document.getText(range)
            debug.appendLine(word)
            let docs = HoverData[word];
            if (Array.isArray(docs)) {
                debug.appendLine("array trigger")
                docs = docs.join("\n\n\n")
                debug.appendLine("array out: "+docs)
            }
	    if (Encryption.includes(word)) docs = docs + "\n\n\**This function cannot be used in encryption.*";
            if (docs) {
                debug.appendLine("h doc "+docs)
                return new vscode.Hover({
                    language: "greyscript",
                    value: new vscode.MarkdownString(docs, true)
                });
            }
        }
    })

    if (vscode.workspace.getConfiguration("greyscript").get("hoverdocs")) context.subscriptions.push(hoverD)

    let decD = vscode.languages.registerDeclarationProvider('greyscript', {
        provideDeclaration(document, position, token) {
            let range = document.getWordRangeAtPosition(position);
            let word = document.getText(range);
            let Exp = new RegExp(`(${word} = |${word}=)`);
            let Text = document.getText();
            let Match = Text.match(Exp);
            let index = Match.index;
            let nt = Text.slice(0, index);
            let lines = nt.split(new RegExp("\n","g")).length;
            let Pos = new vscode.Position(lines-1, word.length);
            return new vscode.Location(document.uri, Pos);
        }
    });

    context.subscriptions.push(decD);

    /*

    let foldD = vscode.languages.registerFoldingRangeProvider('greyscript', {
        provideFoldingRanges(document, foldContext, token) {
            console.log(`Request To Provide Folding Ranges`);
            let Text = document.getText();
            let kind = vscode.FoldingRangeKind.Region;
            var List = [];
            let Exp = new RegExp(`( = |=) function`, `g`);
            let Matches = Text.matchAll(Exp);
            console.log(`Folding Matches`);
            console.log(Matches);
            var i;
            for (i of Matches) {
                let index = i.index;
                console.log(`I: ${index}`);
                let stext = Text.slice(0,index);
                let text = Text.slice(index,Text.length);
                console.log(`T: ${text}`);
                let Exp = new RegExp("end function");
                let M = text.match(Exp)
                console.log(`M: ${M}`)
                if (!M) continue;
                M = M.index+index;
                console.log(`M: ${M}`);
                let start = stext.split("\n").length-1;
                let etext = Text.slice(0, M);
                let end = etext.split("\n").length-1;
                let F = new vscode.FoldingRange(start, end, kind);
                List.push(F);
            };
            console.log(`Folding Ranges`)
            console.log(List);
            return List;
        }
    })

    context.subscriptions.push(foldD);
    */

    let compD = vscode.languages.registerCompletionItemProvider('greyscript', {
        provideCompletionItems(document,position,token,ccontext) {
            if (!vscode.workspace.getConfiguration("greyscript").get("autocomplete")) return;
            let range = document.getWordRangeAtPosition(position);
            let word = document.getText(range);
            //debug.appendLine("request to complete: " + word);
            let output = []
            let match = function(c) {
                let w = word;
                return c.includes(w)
            }
            output = CompData.filter(match)
            var outputS = [];
            var i;
            for (i=0;i<output.length;i++) {
                outputS.push(i+""+output.shift)
            }
            //debug.appendLine("Matches: " + output)
            let c;
            let out = [];
            var a = -1;
            for (c of output) {
                a++
                let type = CompTypes[c] || CompTypes["default"];
                let s = outputS[a]
                let t = new vscode.CompletionItem(c,type)
                t.sortText = s;
                let Ex = Examples[c];
                let Exs = [];
                if (Ex) {
                    let i;
                    for (i=0;i<Ex.length;i++) {
                        Exs[i] = Ex[i].join("\n");
                    }
                }
                var docs = HoverData[c]
                //debug.appendLine("Docs: "+docs)
                if (Array.isArray(docs)) {
                    docs = docs.join("\n\n\n")
                }
		        if (Encryption.includes(c)) docs = docs + "\n\n\**This function cannot be used in encryption.*";
                t.documentation = new vscode.MarkdownString(docs, true);
                if (Ex) t.documentation = new vscode.MarkdownString(docs+"\n\n"+Exs.join("\n\n"), true);
                out.push(t);
            }
            return new vscode.CompletionList(out,true);
        }
    });

    if (vscode.workspace.getConfiguration("greyscript").get("autocomplete")) context.subscriptions.push(compD)
	
    function LookForErrors(source) {
	    let outp = [];
	    let reg = new RegExp(`/(Encode|Decode)(?:\s)=(?\s)function\(.+\).*(${Encryption.join("|")}).*end function/`, "gs");
	    let m = source.match(reg);
	    if (m) {
		    let match;
		    for (match of m) {
			    let s = source.indexOf(m[2]);
			    let e = source.indexOf(m[2])+m[2].length;
			    let li = source.slice(0, s).split("/n").length;
			    let ch = 1;
			    let r = new vscode.Range(s, 1, e, 2)
			    let m = "Cannot use "+m[2]+" in "+ m[1] == "Encode" ? "encryption." : "decryption.";
			    let d = new vscode.Diagnostic(r, m, vscode.DiagnosticSeverity.Warning);
			    outp.push(d):
		    }
	    }
	    return outp;
    }
	
		let collection = vscode.languages.createDiagnosticCollection("greyscript");

	
    function onChange(document) {
	   let uri = document.uri;
	   collection.clear();
	   let e = LookForErrors(document.GetText());
	   collection.set(uri, e);
    }
	
	let collection = vscode.languages.createDiagnosticCollection("greyscript");
	ctx.subscriptions.push(collection);

    let gecmd = vscode.commands.registerTextEditorCommand("greyScript.gotoError", (editor, edit, context) => {
        let options = {"prompt": "Enter provided line number"}
        vscode.window.showInputBox(options).then((line) => {
            line = Number(line;
            //debug.appendLine("line: "+line)
            var text = editor.document.getText();
            var exp = new RegExp("else","gm")
            //debug.appendLine("exp1")
            //debug.appendLine(exp)
            var list = text.matchAll(exp)
            //debug.appendLine("list")
            //debug.appendLine(list)
            var exp2 = new RegExp("else if","gm")
            //debug.appendLine("exp2")
            //debug.appendLine(exp2)
            var list2 = text.matchAll(exp2)
            //debug.appendLine("list2")
            //debug.appendLine(list2)
            var l = 0
            var l2 = 0
            for (i of list) {
                var index = i.index+i[0].length;
                var r = new vscode.Range(1,0,1,index)
                var text = editor.document.getText();
                var nt = text.slice(0, index);
                var lines = nt.split(new RegExp("\n","g")).length;
                if (lines <= line) l++;
            }
            for (i of list2) {
                var index = i.index+i[0].length;
                var text = editor.document.getText();
                var nt = text.slice(0, index);
                var lines = nt.split(new RegExp("\n","g")).length;
                if (lines <= line) l2++;
            }
            //debug.appendLine("l: "+l)
            //debug.appendLine("l2: "+l2)
            var actualline = (line-(l-l2)) // here
            //debug.appendLine("actual error line: "+actualline)
            var linel = editor.document.lineAt(actualline-1).text.length;
            var pos1 = new vscode.Position(actualline-1, 0)
            var pos2 = new vscode.Position(actualline-1, linel)
            var range = new vscode.Range(pos1,pos2)
            //debug.appendLine("range: "+range)
            //editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
            let options = {
                "selection": range
            };
            vscode.window.showTextDocument(editor.document, options)
        });
    });

    context.subscriptions.push(gecmd)
}

function deactivate() {}

module.exports = {activate, deactivate};
