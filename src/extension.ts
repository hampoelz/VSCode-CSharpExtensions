import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { CsProjWriter, BuildActions } from './csprojWriter';
import CodeActionProvider from './codeActionProvider';
import NamespaceDetector from './namespaceDetector';

export function activate(context: vscode.ExtensionContext) {
    const documentSelector: vscode.DocumentSelector = {
        language: 'csharp',
        scheme: 'file'
    };

    context.subscriptions.push(vscode.commands.registerCommand('csharpextensions.createFolder', createFolder));
    context.subscriptions.push(vscode.commands.registerCommand('csharpextensions.createFile', createFile));
    context.subscriptions.push(vscode.commands.registerCommand('csharpextensions.addFiles', addFiles));
    context.subscriptions.push(vscode.commands.registerCommand('csharpextensions.remove', remove));
    context.subscriptions.push(vscode.commands.registerCommand('csharpextensions.rename', rename));
    context.subscriptions.push(vscode.commands.registerCommand('csharpextensions.changeBuildAction', change));

    const codeActionProvider = new CodeActionProvider();

    let disposable = vscode.languages.registerCodeActionsProvider(documentSelector, codeActionProvider);

    context.subscriptions.push(disposable);
}

async function createFolder(args: any) {
    if (args == null) args = { _fsPath: vscode.workspace.rootPath };

    let
        incomingPath: string = args._fsPath || args.fsPath || args.path,
        fileStat = await fs.lstat(incomingPath),
        isDir = fileStat.isDirectory();

    if (!isDir) incomingPath = path.dirname(incomingPath);

    await promptAndAddAsync(incomingPath, 'folder');
}

async function createFile(args: any) {
    if (args == null) args = { _fsPath: vscode.workspace.rootPath };

    let
        template = await vscode.window.showQuickPick([
            { label: "Class", kind: "Class" },
            { label: "Enum", kind: "Enum" },
            { label: "Interface", kind: "Interface" },
            { label: "Page", kind: "Page" },
            { label: "UserControl", kind: "UserControl" },
            { label: "Resource file (.resw)", kind: "Resource" }],
            { ignoreFocusOut: true, placeHolder: 'Please select template' }),
        incomingPath: string = args._fsPath || args.fsPath || args.path,
        fileStat = await fs.lstat(incomingPath),
        isDir = fileStat.isDirectory();

    if (!isDir) incomingPath = path.dirname(incomingPath);
    if (template === undefined) return;

    await promptAndAddAsync(incomingPath, template.kind);
}

async function addFiles(args: any) {
    if (args == null) args = { _fsPath: vscode.workspace.rootPath };

    let
        incomingPath: string = args._fsPath || args.fsPath || args.path,
        fileStat = await fs.lstat(incomingPath),
        isDir = fileStat.isDirectory();

    if (!isDir) incomingPath = path.dirname(incomingPath);

    let files = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true });
    if (files === undefined) return;

    let isPerFileAction = await yesNoPickAsync('Would you like to select the build action for each file individually?');
    if (isPerFileAction === undefined) return;

    let filePaths: string[] = [];
    const ncp = require('ncp').ncp;
    for (let fileUri of files) {
        let sourcePath = fileUri.fsPath || fileUri.path;
        let destinationPath = path.join(incomingPath, path.basename(sourcePath));

        filePaths.push(destinationPath);

        ncp.limit = 16;
        ncp(sourcePath, destinationPath);

        if (isPerFileAction) await selectBuildActionAndAdd([destinationPath]);
    }

    if (!isPerFileAction) await selectBuildActionAndAdd(filePaths);
}

async function remove(args: any) {
    if (args == null) args = { _fsPath: vscode.workspace.rootPath };

    let
        incomingPath: string = args._fsPath || args.fsPath || args.path,
        fileStat = await fs.lstat(incomingPath),
        isDir = fileStat.isDirectory();

    //TODO: Add support to delete multiple files --> https://github.com/microsoft/vscode/issues/3553 

    let removeAction = await yesNoPickAsync("Are you sure you want to remove '" + path.basename(incomingPath) + "'?");
    if (removeAction === undefined || !removeAction) return;

    await removeFromProjectAsync(incomingPath);

    if (isDir) await removeFolderAsync(incomingPath); 
    else await fs.unlink(incomingPath);
}

async function rename(args: any) {
    if (args == null) args = { _fsPath: vscode.workspace.rootPath };

    let incomingPath: string = args._fsPath || args.fsPath || args.path;
    let fileExt = path.extname(incomingPath);

    if (incomingPath.endsWith('.sln') ||
        incomingPath.endsWith('.shproj') ||
        incomingPath.endsWith('.projitems') ||
        incomingPath.endsWith('.csproj') ||
        incomingPath.endsWith('.user') ||
        incomingPath.endsWith('project.json')) {
        vscode.window.showErrorMessage("The name of this file cannot be changed");
        return;
    }

    let newName = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Rename '" + path.basename(incomingPath) + "'", value: path.basename(incomingPath) });
    if (newName === undefined) return;

    let newFileExt = path.extname(newName);
    let newPath = path.join(path.dirname(incomingPath), newName);

    if (fileExt !== newFileExt) {
        let removeAction = await yesNoPickAsync("Are you sure you want to change the extension Name from '" + fileExt + "' to '" + newFileExt + "'?");
        if (removeAction === undefined || !removeAction) newFileExt = fileExt;
    }

    await fs.rename(incomingPath, newPath);

    let buildAction = await getBuildActionAsync(incomingPath);
    if (buildAction !== undefined) {
        await removeFromProjectAsync(incomingPath);
        await addToProjectAsync([newPath], buildAction);
    }
}

async function change(args: any) {
    if (args == null) args = { _fsPath: vscode.workspace.rootPath };

    let
        incomingPath: string = args._fsPath || args.fsPath || args.path,
        fileStat = await fs.lstat(incomingPath),
        isDir = fileStat.isDirectory();

    //TODO: Add support to change multiple files --> https://github.com/microsoft/vscode/issues/3553 

    if (isDir) {
        vscode.window.showErrorMessage("The folder's build action cannot be changed");
        return;
    } else if (incomingPath.endsWith('.sln') ||
        incomingPath.endsWith('.shproj') ||
        incomingPath.endsWith('.projitems') ||
        incomingPath.endsWith('.csproj') ||
        incomingPath.endsWith('.user') ||
        incomingPath === 'project.json') {
        vscode.window.showErrorMessage("The build action of this file cannot be changed");
        return;
    }

    await selectBuildActionAndAdd([incomingPath]);
}

async function selectBuildActionAndAdd(files: string[]) {
    let items: Array<string> = [];

    Object.keys(BuildActions).map(key => {
        if (key === 'Folder') return;
        items.push(key);
    });

    let buildAction = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, placeHolder: 'Please select build action for ' + (files.length > 1 ? 'files' : "'" + path.basename(files[0]) + "'") });
    if (buildAction === undefined) return;

    let buildType = BuildActions[buildAction as keyof typeof BuildActions];
    await addToProjectAsync(files, buildType);
}

async function promptAndAddAsync(incomingPath: string, templateType: string, fileName: string | undefined = undefined) {
    if (templateType === 'folder') {
        let folderName = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: 'Please enter foldername', value: 'new' + templateType });
        if (folderName === undefined) return;

        let folderPath = incomingPath + path.sep + folderName;

        try {
            await fs.access(folderPath);
            vscode.window.showErrorMessage("Folder already exists");
        } catch {
            await fs.mkdir(folderPath);
            await addToProjectAsync([folderPath], BuildActions.Folder);
        }
    } else {
        let extName = "";
        let buildAction = BuildActions.None;
        let addCsFile = false;
        let openBeside = false;

        if (templateType === 'Resource') {
            extName = '.resw';
            buildAction = BuildActions.PRIResource;
        } else if (templateType === 'Class' || templateType === 'Enum' || templateType === 'Interface' || templateType.endsWith('.cs')) {
            extName = '.cs';
            buildAction = BuildActions.Compile;
        } else if (templateType === 'Page' || templateType === 'UserControl') {
            extName = '.xaml';
            buildAction = BuildActions.Page;
            addCsFile = true;
        }

        if (fileName === undefined) fileName = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: 'Please enter filename', value: 'new' + templateType + extName });
        else openBeside = true;
        if (fileName === undefined) return;

        let filePath = correctExtension(incomingPath + path.sep + fileName, extName);

        try {
            await fs.access(filePath);
            vscode.window.showErrorMessage("File already exists");
        } catch {
            const
                namespaceDetector = new NamespaceDetector(filePath),
                namespace = await namespaceDetector.getNamespace(),
                typename = path.basename(fileName, path.extname(fileName));

            await writeFromTemplateAsync(templateType, namespace, typename, filePath, openBeside);
            await addToProjectAsync([filePath], buildAction);

            if (addCsFile) await promptAndAddAsync(incomingPath, templateType + '.cs', fileName);
        }
    }
}

async function writeFromTemplateAsync(type: string, namespace: string, filename: string, filePath: string, openBeside: boolean = false) {
    const extension = vscode.extensions.getExtension('kreativ-software.csharpextensions');

    if (!extension) {
        vscode.window.showErrorMessage('Weird, but the extension you are currently using could not be found');
        return;
    }

    const templateFileName = type + '.tmpl';
    const templateFilePath = path.join(extension.extensionPath, 'templates', templateFileName);

    let template = await vscode.workspace.openTextDocument(templateFilePath);
    let text = template.getText()
        .split('${namespace}').join(namespace)
        .split('${classname}').join(filename);

    const cursorPosition = findCursorInTemplate(text);

    text = text.replace('${cursor}', '');
    await fs.writeFile(filePath, text);

    const file = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(file, openBeside ? {
        viewColumn: vscode.ViewColumn.Beside
    } : {});

    if (cursorPosition != null) editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
}

async function getBuildActionAsync(path: string): Promise<BuildActions | undefined> {
    const csproj = new CsProjWriter();
    const proj = await csproj.getProjFilePath(path);

    if (proj !== undefined) return csproj.get(proj, path);

    return undefined;
}

async function addToProjectAsync(path: string[], type: BuildActions) {
    const csproj = new CsProjWriter();
    const proj = await csproj.getProjFilePath(path[0]);

    if (proj !== undefined) csproj.add(proj, path, type);
}

async function removeFromProjectAsync(path: string) {
    const csproj = new CsProjWriter();
    const proj = await csproj.getProjFilePath(path);

    if (proj !== undefined) csproj.remove(proj, path);
}

async function removeFolderAsync(folderPath: string, removeContentOnly?: boolean) {
    let files;

    try {
        files = await fs.readdir(folderPath);
    } catch (error) {
        throw new Error(error);
    }

    if (files.length) {
        for (let fileName of files) {
            let
                filePath = path.join(folderPath, fileName),
                fileStat = await fs.lstat(filePath),
                isDir = fileStat.isDirectory();

            if (isDir) await removeFolderAsync(filePath);
            else await fs.unlink(filePath);
        }
    }

    if (!removeContentOnly) await fs.rmdir(folderPath);
}

async function yesNoPickAsync(message: string): Promise<boolean | undefined> {
    let input = await vscode.window.showQuickPick(["No", "Yes"], { ignoreFocusOut: true, placeHolder: message });

    if (input === undefined) return undefined;
    else if (input === 'Yes') return true;
    else return false;
}

function correctExtension(fileName: string, extName: string) {
    if (path.extname(fileName) !== extName) {
        if (fileName.endsWith('.')) fileName = fileName + extName.replace('.', '');
        else fileName = fileName + extName;
    }

    return fileName;
}

function findCursorInTemplate(text: string): vscode.Position | null {
    const cursorPos = text.indexOf('${cursor}');
    const preCursor = text.substr(0, cursorPos);
    const matchesForPreCursor = preCursor.match(/\n/gi);

    if (matchesForPreCursor === null) return null;

    const lineNum = matchesForPreCursor.length;
    const charNum = preCursor.substr(preCursor.lastIndexOf('\n')).length;

    return new vscode.Position(lineNum, charNum);
}

export function deactivate() { }
