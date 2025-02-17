import { ExtensionContext } from 'vscode';
import { activate as activateHover } from './hover';
import { activate as activateAutocomplete } from './autocomplete';
import { activate as activateColorpicker } from './colorpicker';
import { activate as activateDebug } from './debug';
import { activate as activateBuild } from './build';
import { activate as activateMinify } from './minify';
import { activate as activateNextError } from './next-error';
import { activate as activateDiagnostic } from './diagnostic';
import { activate as activateDeclaration } from './declaration';
import { activate as activateRefresh } from './refresh';

export function activate(context: ExtensionContext) {
    activateRefresh(context);
    activateHover(context);
    activateAutocomplete(context);
    activateColorpicker(context);
    activateDebug(context);
    activateBuild(context);
    activateMinify(context);
    activateNextError(context);
    activateDiagnostic(context);
    activateDeclaration(context);
}

export function deactivate() {

}