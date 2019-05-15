/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as vscode from "vscode";
import { execSync } from "child_process";
import * as shell from "shelljs";

import {
  workspace as Workspace,
  TextDocument,
  WorkspaceFolder,
  Uri,
  ExtensionContext
} from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions
} from "vscode-languageclient";
import { platform } from "os";

let clients: Map<string, LanguageClient> = new Map();

let _sortedWorkspaceFolders: string[] | undefined;
function sortedWorkspaceFolders(): string[] {
  if (_sortedWorkspaceFolders === void 0) {
    _sortedWorkspaceFolders = Workspace.workspaceFolders
      ? Workspace.workspaceFolders
          .map(folder => {
            let result = folder.uri.toString();
            if (result.charAt(result.length - 1) !== "/") {
              result = result + "/";
            }
            return result;
          })
          .sort((a, b) => {
            return a.length - b.length;
          })
      : [];
  }
  return _sortedWorkspaceFolders;
}
Workspace.onDidChangeWorkspaceFolders(
  () => (_sortedWorkspaceFolders = undefined)
);

function getOuterMostWorkspaceFolder(folder: WorkspaceFolder): WorkspaceFolder {
  let sorted = sortedWorkspaceFolders();
  for (let element of sorted) {
    let uri = folder.uri.toString();
    if (uri.charAt(uri.length - 1) !== "/") {
      uri = uri + "/";
    }
    if (uri.startsWith(element)) {
      return Workspace.getWorkspaceFolder(Uri.parse(element))!;
    }
  }
  return folder;
}

export function activate(context: ExtensionContext) {
  const command =
    platform() == "win32" ? "language_server.bat" : "language_server.sh";

  function didOpenTextDocument(document: TextDocument): void {
    testElixir();

    if (document.languageId !== "elixir" || document.uri.scheme !== "file") {
      return;
    }

    let uri = document.uri;
    let folder = Workspace.getWorkspaceFolder(uri);

    if (!folder) {
      return;
    }

    folder = getOuterMostWorkspaceFolder(folder);

    if (!clients.has(folder.uri.toString())) {
      const serverOpts = {
        command: context.asAbsolutePath("./elixir-ls-release/" + command)
      };
      let serverOptions: ServerOptions = {
        run: serverOpts,
        debug: serverOpts
      };
      let clientOptions: LanguageClientOptions = {
        // Register the server for Elixir documents
        documentSelector: [
          {
            scheme: "file",
            language: "elixir",
            pattern: `${folder.uri.fsPath}/**/*`
          }
          // { language: "elixir", scheme: "untitled" }
        ],
        // Don't focus the Output pane on errors because request handler errors are no big deal
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        workspaceFolder: folder,
        synchronize: {
          // Synchronize the setting section 'elixirLS' to the server
          configurationSection: "elixirLS",
          // Notify the server about file changes to Elixir files contained in the workspace
          fileEvents: [
            Workspace.createFileSystemWatcher(
              `${folder.uri.fsPath}/**/*.{ex,exs,erl,yrl,xrl,eex}`
            )
          ]
        }
      };

      // Create the language client and start the client.
      let client = new LanguageClient(
        "ElixirLS",
        "ElixirLS",
        serverOptions,
        clientOptions
      );
      client.start();
      clients.set(folder.uri.toString(), client);
    }
  }

  Workspace.onDidOpenTextDocument(didOpenTextDocument);
  Workspace.textDocuments.forEach(didOpenTextDocument);
  Workspace.onDidChangeWorkspaceFolders(event => {
    for (let folder of event.removed) {
      let client = clients.get(folder.uri.toString());
      if (client) {
        clients.delete(folder.uri.toString());
        client.stop();
      }
    }
  });
}

export function deactivate(): Thenable<void> {
  let promises: Thenable<void>[] = [];
  for (let client of clients.values()) {
    promises.push(client.stop());
  }
  return Promise.all(promises).then(() => undefined);
}

function testElixirCommand(command: String) {
  try {
    return execSync(`${command} -e ""`);
  } catch {
    return false;
  }
}

function testElixir() {
  var testResult = testElixirCommand("elixir");
  if (testResult === false) {
    // Try finding elixir in the path directly
    const elixirPath = shell.which("elixir");
    if (elixirPath) {
      testResult = testElixirCommand(elixirPath);
    }
  }

  if (!testResult) {
    vscode.window.showErrorMessage(
      "Failed to run 'elixir' command. ElixirLS will probably fail to launch. Logged PATH to Development Console."
    );
    console.warn(
      `Failed to run 'elixir' command. Current process's PATH: ${
        process.env["PATH"]
      }`
    );
    return false;
  } else if (testResult.length > 0) {
    vscode.window.showErrorMessage(
      "Running 'elixir' command caused extraneous print to stdout. See VS Code's developer console for details."
    );
    console.warn(
      "Running 'elixir -e \"\"' printed to stdout:\n" + testResult.toString()
    );
    return false;
  } else {
    return true;
  }
}
