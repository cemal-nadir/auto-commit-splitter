import * as vscode from "vscode";
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as path from "node:path";

type ChangedFile = {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C'; // Modified, Added, Deleted, Renamed, Copied
  oldPath?: string; // for renames
};

type PlanCommit = {
  message: string;
  body?: string;
  files: string[]; // Just file paths instead of complex hunks
};

type Plan = { commits: PlanCommit[] };

type GitCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  shortHash: string;
  changedFiles: string[];
};

type CommitPreviewData = {
  commits: PlanCommit[];
  totalFiles: number;
  changedFiles: ChangedFile[];
};

type ProgressState = {
  isVisible: boolean;
  step: string;
  message: string;
  percentage: number;
};

type GitBranch = {
  name: string;
  current: boolean;
  commit: string;
};

const CFG_SECTION = "autoCommitSplitter";
let isProcessing = false; // Button disable için

class AutoCommitSplitterProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoCommitSplitterView';
  
  private _view?: vscode.WebviewView;
  private _progressState: ProgressState = {
    isVisible: false,
    step: '',
    message: '',
    percentage: 0
  };
  
  constructor(private readonly _extensionUri: vscode.Uri) {}
  
  private updateProgress(step: string, message: string, percentage: number) {
    this._progressState = {
      isVisible: true,
      step,
      message,
      percentage
    };
    this._updateWebview();
  }
  
  private hideProgress() {
    this._progressState = {
      isVisible: false,
      step: '',
      message: '',
      percentage: 0
    };
    this._updateWebview();
  }
  
  private async handleGitLockFile(repoRoot: string): Promise<void> {
    try {
      const lockFile = require('path').join(repoRoot, '.git', 'index.lock');
      const fs = require('fs');
      
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        vscode.window.showInformationMessage('Git lock file removed. Retrying...');
      }
    } catch (error) {
      console.warn('Failed to remove git lock file:', error);
    }
  }
  
  private async runGitWithRetry(repoRoot: string, args: string[], retries: number = 3): Promise<string> {
    for (let i = 0; i < retries; i++) {
      try {
        return await runGit(repoRoot, args);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('index.lock') || errorMessage.includes('Another git process')) {
          if (i < retries - 1) {
            this.updateProgress('retrying', `Git lock detected, retry ${i + 1}/${retries}...`, 0);
            await this.handleGitLockFile(repoRoot);
            // Wait a bit before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error('Max retries reached');
  }
  
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'splitAndCommit':
          await this.handleSplitAndCommit();
          break;
        case 'selectModel':
          await selectModelInteractive();
          this.refresh();
          break;
        case 'refreshData':
          this.refresh();
          break;
        case 'createBranch':
          await this.handleCreateBranch(data.branchName);
          break;
        case 'switchBranch':
          await this.handleSwitchBranch(data.branchName);
          break;
        case 'stageFile':
          await this.handleStageFile(data.filePath);
          break;
        case 'unstageFile':
          await this.handleUnstageFile(data.filePath);
          break;
        case 'discardFile':
          await this.handleDiscardFile(data.filePath);
          break;
        case 'previewCommits':
          await this.handlePreviewCommits();
          break;
        case 'executeCommits':
          await this.handleExecuteCommits(data.commits);
          break;
        case 'cancelPreview':
          this.refresh();
          break;
        case 'toggleSection':
          // Section state is handled on client side
          break;
      }
    });
    
    this.refresh();
  }
  
  public refresh() {
    if (this._view) {
      this._updateWebview();
    }
  }
  
  private async _updateWebview() {
    if (!this._view) return;
    
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this._view.webview.postMessage({ 
          type: 'updateData', 
          data: { error: 'No workspace folder found' }
        });
        return;
      }
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) {
        this._view.webview.postMessage({ 
          type: 'updateData', 
          data: { error: 'Not a Git repository' }
        });
        return;
      }
      
      const [branches, changedFiles, selectedModel, recentCommits] = await Promise.all([
        this.getBranches(repoRoot),
        getChangedFiles(repoRoot),
        this.getSelectedModel(),
        this.getRecentCommits(repoRoot)
      ]);
      
      this._view.webview.postMessage({ 
        type: 'updateData', 
        data: {
          branches,
          changedFiles,
          selectedModel,
          recentCommits,
          isProcessing,
          progress: this._progressState
        }
      });
    } catch (error) {
      console.error('Error updating webview:', error);
      this._view.webview.postMessage({ 
        type: 'updateData', 
        data: { error: error instanceof Error ? error.message : 'Unknown error', progress: this._progressState }
      });
    }
  }
  
  private async getBranches(repoRoot: string): Promise<GitBranch[]> {
    const output = await runGit(repoRoot, ['branch', '-v']);
    const lines = output.trim().split('\n').filter(l => l.trim());
    
    return lines.map(line => {
      const current = line.startsWith('*');
      const cleanLine = line.substring(current ? 2 : 2);
      const parts = cleanLine.split(/\s+/);
      const name = parts[0];
      const commit = parts[1] || '';
      
      return { name, current, commit };
    });
  }
  
  private async getSelectedModel(): Promise<string> {
    const config = vscode.workspace.getConfiguration(CFG_SECTION);
    return config.get<string>('modelId') || 'No model selected';
  }
  
  private async getRecentCommits(repoRoot: string): Promise<GitCommit[]> {
    try {
      const output = await runGit(repoRoot, ['log', '--oneline', '--format=%H|%s|%an|%ad', '--date=relative', '-10']);
      const lines = output.trim().split('\n').filter(l => l.trim());
      
      const commits: GitCommit[] = [];
      
      for (const line of lines) {
        const parts = line.split('|');
        const hash = parts[0] || '';
        
        // Get changed files for this commit
        let changedFiles: string[] = [];
        try {
          const filesOutput = await runGit(repoRoot, ['show', '--name-only', '--pretty=format:', hash]);
          changedFiles = filesOutput.trim().split('\n').filter(f => f.trim());
        } catch (e) {
          // If we can't get files, continue without them
        }
        
        commits.push({
          hash,
          message: parts[1] || '',
          author: parts[2] || '',
          date: parts[3] || '',
          shortHash: hash.substring(0, 7),
          changedFiles
        });
      }
      
      return commits;
    } catch (error) {
      console.warn('Failed to get recent commits:', error);
      return [];
    }
  }
  
  private async handleSplitAndCommit() {
    try {
      isProcessing = true;
      this.refresh();
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder found');
      }
      
      // Just preview first, don't execute
      await this.handlePreviewCommits();
    } catch (error) {
      vscode.window.showErrorMessage(`Split and commit failed: ${error instanceof Error ? error.message : String(error)}`);
      isProcessing = false;
      this.refresh();
    }
  }
  
  private async handlePreviewCommits() {
    try {
      this.updateProgress('analyzing', 'Dosyalar inceleniyor...', 20);
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      const changedFiles = await getChangedFiles(repoRoot);
      if (!changedFiles.length) {
        vscode.window.showInformationMessage('No changes to commit');
        isProcessing = false;
        this.hideProgress();
        this.refresh();
        return;
      }
      
      this.updateProgress('ai-processing', 'AI yanıtı bekleniyor...', 60);
      
      const plan = await generateSimplePlan(repoRoot, changedFiles);
      
      this.updateProgress('preparing', 'Commitler hazırlanıyor...', 90);
      
      // Send preview data to webview
      this._view?.webview.postMessage({
        type: 'showPreview',
        data: {
          commits: plan.commits,
          totalFiles: changedFiles.length,
          changedFiles: changedFiles
        }
      });
      
      isProcessing = false;
      this.hideProgress();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to generate preview: ${error instanceof Error ? error.message : String(error)}`);
      isProcessing = false;
      this.hideProgress();
      this.refresh();
    }
  }
  
  private async handleExecuteCommits(commits: PlanCommit[]) {
    try {
      isProcessing = true;
      this.updateProgress('executing', 'Commitler uygulanıyor...', 0);
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      // Check for existing git lock file before starting
      await this.handleGitLockFile(repoRoot);
      
      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        const progressPercentage = ((i + 1) / commits.length) * 100;
        this.updateProgress('executing', `Commit ${i + 1}/${commits.length} uygulanıyor...`, progressPercentage);
        
        try {
          // Stage files with retry logic
          for (const file of commit.files) {
            await this.runGitWithRetry(repoRoot, ['add', file]);
          }
          
          // Commit with retry logic
          const commitArgs = ['commit', '-m', commit.message];
          if (commit.body?.trim()) {
            commitArgs.push('-m', commit.body.trim());
          }
          await this.runGitWithRetry(repoRoot, commitArgs);
        } catch (commitError) {
          const errorMessage = commitError instanceof Error ? commitError.message : String(commitError);
          
          if (errorMessage.includes('index.lock') || errorMessage.includes('Another git process')) {
            vscode.window.showErrorMessage(`Git lock error during commit ${i + 1}: ${errorMessage}. Please close any Git GUIs and try again.`);
            throw new Error('Git lock file conflict. Please close all Git applications and try again.');
          } else {
            throw commitError;
          }
        }
      }
      
      vscode.window.showInformationMessage(`Successfully created ${commits.length} commits!`);
      isProcessing = false;
      this.hideProgress();
      this.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('index.lock') || errorMessage.includes('Another git process')) {
        vscode.window.showErrorMessage(`Git Lock Error: Another Git process is running. Please close VS Code\'s Git integration, GitHub Desktop, or any other Git GUI and try again. If the problem persists, restart VS Code.`);
      } else {
        vscode.window.showErrorMessage(`Failed to execute commits: ${errorMessage}`);
      }
      
      isProcessing = false;
      this.hideProgress();
      this.refresh();
    }
  }
  
  private async handleCreateBranch(branchName: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      await runGit(repoRoot, ['checkout', '-b', branchName]);
      vscode.window.showInformationMessage(`Created and switched to branch: ${branchName}`);
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create branch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async handleSwitchBranch(branchName: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      await runGit(repoRoot, ['checkout', branchName]);
      vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to switch branch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async handleStageFile(filePath: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      await this.runGitWithRetry(repoRoot, ['add', filePath]);
      vscode.window.showInformationMessage(`Staged: ${filePath}`);
      this.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('index.lock')) {
        vscode.window.showErrorMessage('Git lock error. Please close any Git applications and try again.');
      } else {
        vscode.window.showErrorMessage(`Failed to stage file: ${errorMessage}`);
      }
    }
  }
  
  private async handleUnstageFile(filePath: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      await this.runGitWithRetry(repoRoot, ['restore', '--staged', filePath]);
      vscode.window.showInformationMessage(`Unstaged: ${filePath}`);
      this.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('index.lock')) {
        vscode.window.showErrorMessage('Git lock error. Please close any Git applications and try again.');
      } else {
        vscode.window.showErrorMessage(`Failed to unstage file: ${errorMessage}`);
      }
    }
  }
  
  private async handleDiscardFile(filePath: string) {
    try {
      const result = await vscode.window.showWarningMessage(
        `Are you sure you want to discard changes in ${filePath}?`,
        { modal: true },
        'Discard Changes'
      );
      
      if (result !== 'Discard Changes') return;
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;
      
      const repoRoot = await findGitRepo(workspaceFolder.uri.fsPath);
      if (!repoRoot) return;
      
      await this.runGitWithRetry(repoRoot, ['restore', filePath]);
      vscode.window.showInformationMessage(`Discarded changes: ${filePath}`);
      this.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('index.lock')) {
        vscode.window.showErrorMessage('Git lock error. Please close any Git applications and try again.');
      } else {
        vscode.window.showErrorMessage(`Failed to discard file: ${errorMessage}`);
      }
    }
  }
  
  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Auto Commit Splitter</title>
    <style>
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 16px;
            line-height: 1.4;
        }
        
        .section {
            margin-bottom: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background-color: var(--vscode-panel-background);
            overflow: hidden;
        }
        
        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background-color: var(--vscode-titleBar-inactiveBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            user-select: none;
            transition: background-color 0.2s;
            overflow: visible;
            width: 100%;
        }
        
        .section-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .section-title {
            font-weight: 600;
            color: var(--vscode-titleBar-activeForeground);
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            overflow: visible;
        }
        
        .section-title-text {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .collapse-icon {
            transition: transform 0.2s;
            font-size: 12px;
        }
        
        .collapse-icon.collapsed {
            transform: rotate(-90deg);
        }
        
        .section-content {
            padding: 16px;
            transition: max-height 0.3s ease-out, opacity 0.2s;
            overflow: hidden;
        }
        
        .section-content.collapsed {
            max-height: 0 !important;
            padding: 0 16px;
            opacity: 0;
        }
        
        .button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            margin: 4px 4px 4px 0;
            transition: all 0.2s;
            font-family: inherit;
        }
        
        .button-compact {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            transition: all 0.2s ease;
            white-space: nowrap;
            flex: none;
            min-width: auto;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
            text-align: center;
            margin: 0;
        }
        
        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        
        .button-compact:hover {
            background-color: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
        
        .button:active {
            transform: translateY(0);
        }
        
        .button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .button-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .button-compact.button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .button-compact.button-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .button-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }
        
        .button-success {
            background-color: var(--vscode-gitDecoration-addedResourceForeground);
            color: var(--vscode-editor-background);
        }
        
        .input {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            width: 100%;
            font-family: inherit;
            transition: border-color 0.2s;
        }
        
        .input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            transition: background-color 0.2s;
            gap: 8px;
        }
        

        
        .file-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            margin: 0 -12px;
            padding: 10px 12px;
            border-radius: 4px;
        }
        
        .file-item:last-child {
            border-bottom: none;
        }
        
        .file-status {
            width: 24px;
            font-weight: bold;
            margin-right: 12px;
            text-align: center;
            font-size: 11px;
        }
        
        .file-path {
            flex: 1;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            margin-right: 12px;
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: normal;
            min-width: 0;
        }
        
        .file-actions {
            display: flex;
            gap: 6px;
        }
        
        .file-actions .button {
            padding: 4px 8px;
            font-size: 10px;
            margin: 0;
        }
        
        .branch-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            transition: background-color 0.2s;
            gap: 8px;
        }
        
        @media (max-width: 500px) {
            .branch-item {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .branch-info {
                width: 100%;
            }
        }
        
        .branch-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            margin: 0 -12px;
            padding: 10px 12px;
            border-radius: 4px;
        }
        
        .branch-item:last-child {
            border-bottom: none;
        }
        
        .branch-info {
            display: flex;
            flex-direction: column;
            flex: 1;
        }
        
        .branch-name {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            font-weight: 500;
        }
        
        .branch-current {
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }
        
        .branch-commit {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        
        .model-status {
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            border: 1px solid var(--vscode-widget-border);
        }
        
        .status-modified { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
        .status-added { color: var(--vscode-gitDecoration-addedResourceForeground); }
        .status-deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); }
        .status-renamed { color: var(--vscode-gitDecoration-renamedResourceForeground); }
        .status-copied { color: var(--vscode-gitDecoration-copiedResourceForeground); }
        
        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 12px;
            border-radius: 4px;
            font-size: 12px;
        }
        
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
        }
        
        .branch-input-section {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-top: 12px;
        }
        
        .branch-input {
            flex: 1;
        }
        
        .main-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .section-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }
        
        .section-row .section {
            flex: 1;
            margin-bottom: 0;
            min-width: 250px;
        }
        
        @media (max-width: 800px) {
            .section-row {
                flex-direction: column;
            }
            
            .section-row .section {
                min-width: unset;
                margin-bottom: 8px;
            }
        }
        
        @media (max-width: 600px) {
            .section-row .section {
                min-width: unset;
            }
            
            .section-title {
                font-size: 12px;
            }
            
            .section-info {
                font-size: 9px;
                white-space: nowrap;
            }
        }
        
        @media (max-width: 400px) {
            body {
                padding: 8px;
            }
            
            .section {
                border-radius: 4px;
            }
            
            .section-header {
                padding: 8px 12px;
            }
            
            .section-content {
                padding: 12px;
            }
            
            .button {
                padding: 6px 12px;
                font-size: 11px;
            }
        }
        

        
        .commit-item {
            padding: 12px 0;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        
        .commit-item:last-child {
            border-bottom: none;
        }
        
        .commit-hash {
            font-family: var(--vscode-editor-font-family);
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }
        
        .commit-message {
            font-size: 12px;
            margin: 4px 0;
            word-wrap: break-word;
        }
        
        .commit-meta {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin: 2px 0;
        }
        
        .commit-files {
            margin-top: 6px;
        }
        
        .commit-files-label {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        
        .commit-file-list {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        
        .commit-file-item {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            color: var(--vscode-textPreformat-foreground);
            word-break: break-all;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .preview-container {
            background-color: var(--vscode-editor-background);
            border: 2px solid var(--vscode-focusBorder);
            border-radius: 6px;
            margin: 16px 0;
            overflow: hidden;
        }
        
        .preview-header {
            background-color: var(--vscode-titleBar-activeBackground);
            color: var(--vscode-titleBar-activeForeground);
            padding: 12px 16px;
            font-weight: 600;
        }
        
        .preview-content {
            padding: 16px;
        }
        
        .preview-commit {
            margin-bottom: 16px;
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            border-left: 4px solid var(--vscode-gitDecoration-addedResourceForeground);
        }
        
        .preview-commit-title {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 6px;
            word-wrap: break-word;
        }
        
        .preview-commit-body {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            line-height: 1.4;
            word-wrap: break-word;
        }
        
        .preview-files {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }
        
        .preview-file-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
        }
        
        .preview-file-tag {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 9px;
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .preview-actions {
            display: flex;
            gap: 8px;
            padding: 16px;
            background-color: var(--vscode-panel-background);
            border-top: 1px solid var(--vscode-panel-border);
            flex-wrap: wrap;
        }
        
        @media (max-width: 500px) {
            .preview-actions {
                flex-direction: column;
                gap: 12px;
            }
            
            .preview-actions .button {
                width: 100%;
                justify-content: center;
            }
        }
        
        .hidden {
            display: none;
        }
        
        .progress-container {
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            margin: 16px 0;
            text-align: center;
        }
        
        @media (max-width: 400px) {
            .progress-container {
                padding: 12px;
                margin: 12px 0;
            }
        }
        
        .progress-message {
            font-size: 12px;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }
        
        .progress-bar {
            width: 100%;
            height: 6px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 3px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-background);
            background: linear-gradient(90deg, 
                var(--vscode-button-background) 0%, 
                var(--vscode-button-hoverBackground) 50%, 
                var(--vscode-button-background) 100%);
            transition: width 0.3s ease;
            animation: progressPulse 1.5s infinite;
        }
        
        @keyframes progressPulse {
            0%, 100% { opacity: 0.8; }
            50% { opacity: 1; }
        }
        
        .progress-step {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
        }
        
        .badge {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 8px;
        }
    </style>
</head>
<body>
    <!-- Fixed Header with Model and Actions -->
    <div style="background-color: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
        <!-- AI Model Section -->
        <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px; color: var(--vscode-titleBar-activeForeground);">
                🤖 AI Model: <span style="color: var(--vscode-descriptionForeground); font-weight: normal;" id="modelInfo">No model</span>
            </div>
            <div id="modelStatus" class="model-status">Loading...</div>
        </div>
        
        <!-- Action Buttons -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
            <button id="splitButton" class="button-compact" onclick="previewCommits()">🚀 Generate Plan</button>
            <button class="button-compact button-secondary" onclick="refreshData()">🔄 Refresh</button>
            <button class="button-compact" onclick="selectModel()">⚙️ Select Model</button>
        </div>
    </div>

    

    
    <div id="progressContainer" class="hidden">
        <div class="progress-container">
            <div class="progress-message" id="progressMessage">İşlem başlatılıyor...</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            </div>
            <div class="progress-step" id="progressStep"></div>
        </div>
    </div>
    
    <div id="previewContainer" class="hidden">
        <div class="preview-container">
            <div class="preview-header">
                📋 Commit Preview
            </div>
            <div class="preview-content" id="previewContent">
                <!-- Preview content will be inserted here -->
            </div>
            <div class="preview-actions">
                <button class="button button-success" onclick="executeCommits()">✅ Execute Commits</button>
                <button class="button button-secondary" onclick="cancelPreview()">❌ Cancel</button>
            </div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-header" onclick="toggleSection('branches')">
            <div class="section-title">
                <div class="section-title-text">
                    🌿 <span>Branches</span>
                </div>
                <span class="badge" id="branchInfo">-</span>
            </div>
            <span class="collapse-icon">▼</span>
        </div>
        <div class="section-content" id="branchesContent">
            <div id="branchesList">Loading...</div>
            <div class="branch-input-section">
                <input id="newBranchName" class="input branch-input" placeholder="New branch name..." />
                <button class="button button-secondary" onclick="createBranch()">Create</button>
            </div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-header" onclick="toggleSection('commits')">
            <div class="section-title">
                <div class="section-title-text">
                    📝 <span>Recent Commits</span>
                </div>
                <span class="badge" id="commitInfo">-</span>
            </div>
            <span class="collapse-icon">▼</span>
        </div>
        <div class="section-content" id="commitsContent">
            <div id="commitsList">Loading...</div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-header" onclick="toggleSection('files')">
            <div class="section-title">
                <div class="section-title-text">
                    📁 <span>Changed Files</span>
                </div>
                <span class="badge" id="filesBadge">0</span>
                <span class="collapse-icon">▼</span>
            </div>
        </div>
        <div class="section-content" id="filesContent">
            <div id="filesList">Loading...</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = null;
        let previewData = null;
        let sectionStates = {
            branches: false,
            commits: false,
            files: false
        };
        
        function updateProgress(progressState) {
            const progressContainer = document.getElementById('progressContainer');
            const progressMessage = document.getElementById('progressMessage');
            const progressFill = document.getElementById('progressFill');
            const progressStep = document.getElementById('progressStep');
            
            if (progressState.isVisible) {
                progressContainer.classList.remove('hidden');
                progressMessage.textContent = progressState.message;
                progressFill.style.width = progressState.percentage + '%';
                progressStep.textContent = progressState.step;
            } else {
                progressContainer.classList.add('hidden');
            }
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateData':
                    currentData = message.data;
                    updateUI();
                    break;
                case 'showPreview':
                    previewData = message.data;
                    showPreview();
                    break;
            }
        });
        
        function updateUI() {
            if (!currentData) return;
            
            if (currentData.error) {
                document.body.innerHTML = \`<div class="error">❌ \${currentData.error}</div>\`;
                return;
            }
            
            // Update progress if available
            if (currentData.progress) {
                updateProgress(currentData.progress);
            }
            
            // Update model info
            const modelInfo = document.getElementById('modelInfo');
            const modelStatus = document.getElementById('modelStatus');
            const selectedModel = currentData.selectedModel || 'No model selected';
            const shortModelName = selectedModel.length > 30 ? selectedModel.substring(0, 27) + '...' : selectedModel;
            modelInfo.textContent = shortModelName;
            modelInfo.title = selectedModel; // Full name on hover
            modelStatus.textContent = selectedModel;
            
            // Update branch info
            const branchInfo = document.getElementById('branchInfo');
            if (currentData.branches && currentData.branches.length > 0) {
                const currentBranch = currentData.branches.find(b => b.current);
                const branchName = currentBranch ? currentBranch.name : '-';
                branchInfo.textContent = branchName; // FULL NAME - no truncation
                branchInfo.title = branchName; // Full name on hover
            } else {
                branchInfo.textContent = '-';
            }
            
            // Update commit info
            const commitInfo = document.getElementById('commitInfo');
            if (currentData.recentCommits && currentData.recentCommits.length > 0) {
                const lastCommit = currentData.recentCommits[0];
                const commitMsg = lastCommit.message.length > 25 ? lastCommit.message.substring(0, 22) + '...' : lastCommit.message;
                const commitDate = lastCommit.date;
                commitInfo.textContent = \`\${commitMsg} • \${commitDate}\`;
                commitInfo.title = \`\${lastCommit.message} • \${lastCommit.date}\`; // Full info on hover
            } else {
                commitInfo.textContent = '-';
            }
            
            // Update split button state
            const splitButton = document.getElementById('splitButton');
            splitButton.disabled = currentData.isProcessing;
            splitButton.textContent = currentData.isProcessing ? '⏳ Processing...' : '🚀 Generate Commit Plan';
            
            // Update branches
            updateBranches();
            
            // Update recent commits
            updateRecentCommits();
            
            // Update files
            updateFiles();
            
            // Restore section states
            restoreSectionStates();
        }
        
        function updateBranches() {
            const branchesList = document.getElementById('branchesList');
            if (currentData.branches && currentData.branches.length > 0) {
                // Sort branches: current branch first, then alphabetically
                const sortedBranches = [...currentData.branches].sort((a, b) => {
                    if (a.current && !b.current) return -1;
                    if (!a.current && b.current) return 1;
                    return a.name.localeCompare(b.name);
                });
                
                branchesList.innerHTML = sortedBranches.map(branch => \`
                    <div class="branch-item">
                        <div class="branch-info">
                            <div class="branch-name \${branch.current ? 'branch-current' : ''}">\${branch.name}</div>
                            <div class="branch-commit">\${branch.commit.substring(0, 7)}</div>
                        </div>
                        \${!branch.current ? \`<button class="button button-secondary" onclick="switchBranch('\${branch.name}')">Switch</button>\` : '<span style="color: var(--vscode-gitDecoration-addedResourceForeground); font-size: 10px; font-weight: 600;">CURRENT</span>'}
                    </div>
                \`).join('');
            } else {
                branchesList.innerHTML = '<div class="loading">No branches found</div>';
            }
        }
        
        function updateRecentCommits() {
            const commitsList = document.getElementById('commitsList');
            if (currentData.recentCommits && currentData.recentCommits.length > 0) {
                commitsList.innerHTML = currentData.recentCommits.map(commit => \`
                    <div class="commit-item">
                        <div class="commit-hash">\${commit.shortHash}</div>
                        <div class="commit-message">\${commit.message}</div>
                        <div class="commit-meta">by \${commit.author} • \${commit.date}</div>
                        \${commit.changedFiles && commit.changedFiles.length > 0 ? \`
                            <div class="commit-files">
                                <div class="commit-files-label">\${commit.changedFiles.length} file(s) changed:</div>
                                <div class="commit-file-list">
                                    \${commit.changedFiles.slice(0, 3).map(file => \`<div class="commit-file-item" title="\${file}">\${file}</div>\`).join('')}
                                    \${commit.changedFiles.length > 3 ? \`<div class="commit-file-item">+\${commit.changedFiles.length - 3} more</div>\` : ''}
                                </div>
                            </div>
                        \` : ''}
                    </div>
                \`).join('');
            } else {
                commitsList.innerHTML = '<div class="loading">No recent commits</div>';
            }
        }
        
        function updateFiles() {
            const filesList = document.getElementById('filesList');
            const filesBadge = document.getElementById('filesBadge');
            
            if (currentData.changedFiles && currentData.changedFiles.length > 0) {
                filesBadge.textContent = currentData.changedFiles.length;
                filesList.innerHTML = currentData.changedFiles.map(file => {
                    const statusClass = \`status-\${getFileStatusClass(file.status)}\`;
                    return \`
                        <div class="file-item">
                            <div class="file-status \${statusClass}">\${file.status}</div>
                            <div class="file-path">\${file.path}</div>
                            <div class="file-actions">
                                <button class="button button-secondary" onclick="stageFile('\${file.path}')">Stage</button>
                                <button class="button button-secondary" onclick="unstageFile('\${file.path}')">Unstage</button>
                                <button class="button button-danger" onclick="discardFile('\${file.path}')">Discard</button>
                            </div>
                        </div>
                    \`;
                }).join('');
            } else {
                filesBadge.textContent = '0';
                filesList.innerHTML = '<div class="loading">No changes found</div>';
            }
        }
        
        function showPreview() {
            if (!previewData) return;
            
            const previewContainer = document.getElementById('previewContainer');
            const previewContent = document.getElementById('previewContent');
            
            previewContent.innerHTML = \`
                <div style="margin-bottom: 16px;">
                    <strong>\${previewData.commits.length} commits</strong> will be created for <strong>\${previewData.totalFiles} changed files</strong>
                </div>
                \${previewData.commits.map((commit, index) => \`
                    <div class="preview-commit">
                        <div class="preview-commit-title">📝 \${commit.message}</div>
                        <div class="preview-commit-body">\${commit.body || 'No description provided'}</div>
                        <div class="preview-files">
                            <strong>Files (\${commit.files.length}):</strong>
                            <div class="preview-file-tags">
                                \${commit.files.map(file => \`<div class="preview-file-tag" title="\${file}">\${file}</div>\`).join('')}
                            </div>
                        </div>
                    </div>
                \`).join('')}
            \`;
            
            previewContainer.classList.remove('hidden');
            previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId + 'Content');
            const icon = document.querySelector(\`#\${sectionId}Content\`).parentElement.querySelector('.collapse-icon');
            
            sectionStates[sectionId] = !sectionStates[sectionId];
            
            if (sectionStates[sectionId]) {
                content.classList.remove('collapsed');
                content.style.maxHeight = content.scrollHeight + 'px';
                if (icon) {
                    icon.classList.remove('collapsed');
                }
            } else {
                content.style.maxHeight = content.scrollHeight + 'px';
                setTimeout(() => {
                    content.classList.add('collapsed');
                    content.style.maxHeight = '0px';
                    if (icon) {
                        icon.classList.add('collapsed');
                    }
                }, 10);
            }
        }
        
        function restoreSectionStates() {
            for (const [sectionId, isOpen] of Object.entries(sectionStates)) {
                const content = document.getElementById(sectionId + 'Content');
                const icon = content.parentElement.querySelector('.collapse-icon');
                
                if (isOpen) {
                    content.classList.remove('collapsed');
                    content.style.maxHeight = 'none';
                    if (icon) {
                        icon.classList.remove('collapsed');
                    }
                } else {
                    content.classList.add('collapsed');
                    content.style.maxHeight = '0px';
                    if (icon) {
                        icon.classList.add('collapsed');
                    }
                }
            }
        }
        
        function getFileStatusClass(status) {
            switch (status) {
                case 'M': return 'modified';
                case 'A': return 'added';
                case 'D': return 'deleted';
                case 'R': return 'renamed';
                case 'C': return 'copied';
                default: return 'modified';
            }
        }
        
        function previewCommits() {
            vscode.postMessage({ type: 'splitAndCommit' });
        }
        
        function executeCommits() {
            if (previewData) {
                vscode.postMessage({ type: 'executeCommits', commits: previewData.commits });
                document.getElementById('previewContainer').classList.add('hidden');
            }
        }
        
        function cancelPreview() {
            document.getElementById('previewContainer').classList.add('hidden');
            vscode.postMessage({ type: 'cancelPreview' });
        }
        
        function selectModel() {
            vscode.postMessage({ type: 'selectModel' });
        }
        
        function refreshData() {
            vscode.postMessage({ type: 'refreshData' });
        }
        
        function createBranch() {
            const branchName = document.getElementById('newBranchName').value.trim();
            if (branchName) {
                vscode.postMessage({ type: 'createBranch', branchName });
                document.getElementById('newBranchName').value = '';
            }
        }
        
        function switchBranch(branchName) {
            vscode.postMessage({ type: 'switchBranch', branchName });
        }
        
        function stageFile(filePath) {
            vscode.postMessage({ type: 'stageFile', filePath });
        }
        
        function unstageFile(filePath) {
            vscode.postMessage({ type: 'unstageFile', filePath });
        }
        
        function discardFile(filePath) {
            vscode.postMessage({ type: 'discardFile', filePath });
        }
        
        // Request initial data
        vscode.postMessage({ type: 'refreshData' });
    </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Auto Commit Splitter: Extension activating...');
  
  // Create and register the webview provider
  const provider = new AutoCommitSplitterProvider(context.extensionUri);
  
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AutoCommitSplitterProvider.viewType, 
      provider
    )
  );
  
  // Register selectModel command
  const selectModelCommand = vscode.commands.registerCommand('autoCommitSplitter.selectModel', async () => {
    console.log('Auto Commit Splitter: selectModel command triggered');
    try {
      await selectModelInteractive();
      provider.refresh();
    } catch (error) {
      console.error('Auto Commit Splitter: selectModel error:', error);
      vscode.window.showErrorMessage(`Model selection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  
  // Register splitAndCommit command
  const splitAndCommitCommand = vscode.commands.registerCommand('autoCommitSplitter.splitAndCommit', async () => {
    console.log('Auto Commit Splitter: splitAndCommit command triggered');
    
    if (isProcessing) {
      vscode.window.showWarningMessage('Auto Commit Splitter is already running. Please wait...');
      return;
    }
    
    try {
      isProcessing = true;
      provider.refresh();
      await vscode.window.withProgress(
        { 
          location: vscode.ProgressLocation.Notification, 
          title: '🤖 Auto Commit Splitter', 
          cancellable: false 
        },
        async (progress) => {
          await splitAndCommit(progress);
        }
      );
    } catch (error) {
      console.error('Auto Commit Splitter: splitAndCommit error:', error);
      vscode.window.showErrorMessage(`Split and commit failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isProcessing = false;
      provider.refresh();
    }
  });
  
  // Register panel commands
  const openPanelCommand = vscode.commands.registerCommand('autoCommitSplitter.openPanel', async () => {
    vscode.commands.executeCommand('autoCommitSplitterView.focus');
  });
  
  const refreshPanelCommand = vscode.commands.registerCommand('autoCommitSplitter.refreshPanel', async () => {
    provider.refresh();
  });
  
  context.subscriptions.push(
    selectModelCommand, 
    splitAndCommitCommand,
    openPanelCommand,
    refreshPanelCommand
  );
  
  console.log('Auto Commit Splitter: Extension activated successfully');
}

async function runSplitAndCommit(workspaceFolder: vscode.WorkspaceFolder) {
  await vscode.window.withProgress(
    { 
      location: vscode.ProgressLocation.Notification, 
      title: '🤖 Auto Commit Splitter', 
      cancellable: false 
    },
    async (progress) => {
      await splitAndCommit(progress);
    }
  );
}

async function splitAndCommit(progress: vscode.Progress<{ message?: string }>) {
  progress.report({ message: 'Checking repository...' });
  
  const workspaceFolders = vscode.workspace.workspaceFolders;
  console.log('Auto Commit Splitter: workspaceFolders:', workspaceFolders);
  
  if (!workspaceFolders?.length) {
    throw new Error("No workspace folder is open.");
  }

  let repoRoot: string | undefined;
  
  for (const folder of workspaceFolders) {
    const path = folder.uri.fsPath;
    console.log('Auto Commit Splitter: Checking git repo in:', path);
    repoRoot = await getGitTopLevel(path);
    if (repoRoot) {
      console.log('Auto Commit Splitter: Git repo root:', repoRoot);
      break;
    }
  }

  if (!repoRoot) {
    throw new Error("No git repository found in workspace");
  }

  progress.report({ message: 'Analyzing changes...' });

  // Get changed files (much simpler than hunks!)
  const changedFiles = await getChangedFiles(repoRoot);
  if (changedFiles.length === 0) {
    throw new Error("No changes to commit");
  }

  progress.report({ message: 'Generating plan with AI...' });

  // Generate plan based on files, not hunks
  const plan = await generateSimplePlan(repoRoot, changedFiles);
  
  // Show commit preview UI
  progress.report({ message: 'Preparing preview...' });
  const userApproved = await showCommitPreview(plan, changedFiles);
  
  if (!userApproved) {
    vscode.window.showInformationMessage('Operation cancelled by user.');
    return;
  }

  progress.report({ message: 'Executing commits...' });
  
  // Execute the plan
  await executeSimplePlan(repoRoot, plan, changedFiles);
  
  // Auto-add remaining files
  progress.report({ message: 'Checking for remaining files...' });
  await addRemainingFiles(repoRoot);
  
  vscode.window.showInformationMessage(`✅ Successfully created ${plan.commits.length} commit(s)!`);
}

async function getChangedFiles(repoRoot: string): Promise<ChangedFile[]> {
  const output = await runGit(repoRoot, ["status", "--porcelain"]);
  console.log(`Auto Commit Splitter: git status raw output: "${output}"`);
  const lines = output.trim().split('\n').filter(l => l.trim());
  console.log(`Auto Commit Splitter: git status lines:`, lines);
  
  const files: ChangedFile[] = [];
  for (const line of lines) {
    if (line.length < 3) continue;
    
    // Handle malformed git status lines (missing first character)
    let actualLine = line;
    let statusIndex = 1;
    let pathStartIndex = 3;
    
    // Check if line starts with status character directly (malformed)
    // Only fix M, A, D, R, C - not ?? (untracked files are normal)
    if (line.match(/^[MADRC]/)) {
      console.log(`Auto Commit Splitter: Detected malformed git status line: "${line}", fixing...`);
      // Add missing space at the beginning
      actualLine = ' ' + line;
      statusIndex = 1;
      pathStartIndex = 3;
    }
    
    const status = actualLine[statusIndex] as 'M' | 'A' | 'D' | 'R' | 'C';
    const path = actualLine.substring(pathStartIndex);
    console.log(`Auto Commit Splitter: Parsed line: "${line}" -> status: "${status}", path: "${path}"`);
    
    files.push({ path, status });
  }
  
  console.log('Auto Commit Splitter: Changed files:', files.map(f => `${f.status} ${f.path}`));
  return files;
}

async function generateSimplePlan(repoRoot: string, changedFiles: ChangedFile[]): Promise<Plan> {
  const fileList = changedFiles.map(f => `${f.status} ${f.path}`).join('\n');
  const diffSummary = await runGit(repoRoot, ["diff", "--stat"]);
  
  const prompt = `You are an expert Git commit organizer. Analyze these changed files and create a logical commit plan.

Changed Files:
${fileList}

Diff Summary:
${diffSummary}

Rules:
1. Group related files into logical commits
2. Each commit should have a focused, single purpose  
3. Use conventional commit format: type(scope): description
4. Keep commits atomic and reviewable
5. Put dependencies in correct order

Return ONLY a JSON object with this format:
{
  "commits": [
    {
      "message": "feat(auth): add user authentication",
      "body": "Optional detailed description",
      "files": ["src/auth.ts", "src/types.ts"]
    }
  ]
}`;

  console.log('Auto Commit Splitter: Calling AI for file-based plan...');
  const response = await callLanguageModel(prompt);
  console.log('Auto Commit Splitter: AI Response:', response);
  
  const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n\s*```/) || response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON format");
  }
  
  const jsonStr = jsonMatch[1] || jsonMatch[0];
  console.log('Auto Commit Splitter: Extracted JSON:', jsonStr);
  
  let plan: Plan;
  try {
    plan = JSON.parse(jsonStr);
  } catch (parseError) {
    throw new Error(`Failed to parse AI response as JSON: ${parseError}`);
  }
  
  console.log('Auto Commit Splitter: Parsed Plan:', plan);
  
  // Validate plan
  validateSimplePlan(plan, changedFiles);
  
  return plan;
}

function validateSimplePlan(plan: Plan, changedFiles: ChangedFile[]) {
  const allFiles = new Set(changedFiles.map(f => f.path));
  const seenFiles = new Set<string>();
  
  for (const commit of plan.commits) {
    if (!commit.message?.trim()) {
      throw new Error("Commit message cannot be empty");
    }
    
    // Auto-fix: Filter out non-existent files instead of failing
    const validFiles = commit.files.filter(file => {
      if (!allFiles.has(file)) {
        console.log(`Auto Commit Splitter: Removing non-existent file '${file}' from plan`);
        return false;
      }
      return true;
    });
    
    commit.files = validFiles;
    
    if (!commit.files?.length) {
      console.log(`Auto Commit Splitter: Commit '${commit.message}' has no valid files, removing commit`);
      continue;
    }
    
    // Handle duplicate files
    const uniqueFiles = [];
    for (const file of commit.files) {
      if (seenFiles.has(file)) {
        console.log(`Auto Commit Splitter: Found duplicate file '${file}', removing from this commit`);
        continue;
      }
      
      seenFiles.add(file);
      uniqueFiles.push(file);
    }
    
    commit.files = uniqueFiles;
  }
  
  // Remove empty commits
  plan.commits = plan.commits.filter(c => c.files?.length > 0);
  
  if (!plan.commits.length) {
    throw new Error("No valid commits in plan");
  }
  
  // Auto-fix: Add missing files to last commit
  const missingFiles = [...allFiles].filter(file => !seenFiles.has(file));
  if (missingFiles.length) {
    console.log(`Auto Commit Splitter: Auto-fixing ${missingFiles.length} missing files`);
    console.log(`Auto Commit Splitter: Missing files list:`, missingFiles);
    const lastCommit = plan.commits[plan.commits.length - 1];
    lastCommit.files = [...lastCommit.files, ...missingFiles];
    lastCommit.message = lastCommit.message.replace(/^(\w+)(\([^)]+\))?:\s*/, '$1$2: ');
    lastCommit.body = (lastCommit.body ?? '') + 
      `\n\n[Auto-fixed: Added ${missingFiles.length} missing files]`;
  }
}

async function executeSimplePlan(repoRoot: string, plan: Plan, changedFiles: ChangedFile[]) {
  console.log(`Auto Commit Splitter: Executing plan with ${plan.commits.length} commits...`);
  
  for (let i = 0; i < plan.commits.length; i++) {
    const commit = plan.commits[i];
    
    console.log(`Auto Commit Splitter: Processing commit ${i + 1}/${plan.commits.length}: ${commit.message}`);
    
    // Stage the files for this commit
    for (const file of commit.files) {
      try {
        await runGit(repoRoot, ["add", file]);
      } catch (error) {
        console.warn(`Failed to add ${file}:`, error);
      }
    }
    
    // Check if anything was actually staged
    const staged = await runGit(repoRoot, ["diff", "--cached", "--name-only"]);
    if (!staged.trim()) {
      console.warn(`No files staged for commit "${commit.message}", skipping...`);
      continue;
    }
    
    // Create the commit
    const commitArgs = ["commit", "-m", commit.message];
    if (commit.body?.trim()) {
      commitArgs.push("-m", commit.body.trim());
    }
    
    await runGit(repoRoot, commitArgs);
    console.log(`Auto Commit Splitter: Created commit ${i + 1}/${plan.commits.length}: ${commit.message}`);
  }
}

// ... (keep all the helper functions like runGit, selectModelInteractive, callLanguageModel, etc.)

async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`Auto Commit Splitter: Running git ${args.join(' ')} in ${cwd}`);
    const child = spawn("git", args, { 
      cwd, 
      stdio: ["pipe", "pipe", "pipe"],
      shell: false  // Use shell false with args array for proper escaping
    });
    
    let stdout = "";
    let stderr = "";
    
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(' ')} failed (${code}). ${stderr.trim()}`));
      }
    });
  });
}

async function selectModelInteractive() {
  console.log('Auto Commit Splitter: Starting model selection...');
  
  try {
    // Get all available models
    const models = await vscode.lm.selectChatModels();
    console.log('Auto Commit Splitter: Available models:', models.map(m => m.name));
    
    if (models.length === 0) {
      vscode.window.showErrorMessage("No language models available. Please install a compatible AI extension.");
      return;
    }
    
    // Show quickpick to user
    const modelItems = models.map(model => ({
      label: model.name,
      description: `${model.vendor} - ${model.family}`,
      model: model
    }));
    
    const selectedItem = await vscode.window.showQuickPick(modelItems, {
      placeHolder: 'Select an AI model for commit generation'
    });
    
    if (!selectedItem) {
      return; // User cancelled
    }
    
    const selectedModel = selectedItem.model;
    console.log(`Auto Commit Splitter: Selected model: ${selectedModel.name}`);
    
    const config = vscode.workspace.getConfiguration(CFG_SECTION);
    await config.update("modelId", selectedModel.name, vscode.ConfigurationTarget.Global);
    
    vscode.window.showInformationMessage(`Selected model: ${selectedModel.name}`);
  } catch (error) {
    console.error('Auto Commit Splitter: Error in selectModelInteractive:', error);
    vscode.window.showErrorMessage(`Model selection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function callLanguageModel(prompt: string): Promise<string> {
  const config = vscode.workspace.getConfiguration(CFG_SECTION);
  const selectedModelName = config.get<string>("modelId");
  
  console.log(`Found configured model: ${selectedModelName}`);
  
  const models = await vscode.lm.selectChatModels();
  let model = models.find(m => m.name === selectedModelName);
  
  // If configured model not found, use first available
  if (!model && models.length > 0) {
    console.log(`Auto Commit Splitter: Configured model not found, using: ${models[0].name}`);
    model = models[0];
  }
  
  if (!model) {
    throw new Error("No AI model available. Please install a compatible AI extension.");
  }
  
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  
  const chatResponse = await model.sendRequest(messages, {});
  
  let fullResponse = "";
  for await (const fragment of chatResponse.text) {
    fullResponse += fragment;
  }
  
  return fullResponse;
}

async function getGitTopLevel(cwd: string): Promise<string | undefined> {
  try {
    console.log('Auto Commit Splitter: Running git rev-parse in:', cwd);
    const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    const p = out.trim();
    console.log('Auto Commit Splitter: Git top level result:', p);
    return p ? p : undefined;
  } catch (error) {
    console.log('Auto Commit Splitter: Git rev-parse failed:', error);
    return undefined;
  }
}

async function findGitRepo(startPath: string): Promise<string | undefined> {
  return await getGitTopLevel(startPath);
}

function isConventionalCommitHeader(s: string) {
  return /^[a-z]+(\([^)]+\))?:\s.{1,72}$/.test((s ?? "").trim());
}

async function showCommitPreview(plan: Plan, changedFiles: ChangedFile[]): Promise<boolean> {
  const filesByPath = new Map(changedFiles.map(f => [f.path, f]));
  
  const items = plan.commits.map((commit, index) => {
    const fileCount = commit.files.length;
    const filesList = commit.files.slice(0, 3).map(f => {
      const file = filesByPath.get(f);
      const statusIcon = file?.status === 'A' ? '+' : file?.status === 'D' ? '-' : '~';
      return `${statusIcon} ${f.split('/').pop()}`;
    }).join(', ');
    
    const moreText = fileCount > 3 ? ` + ${fileCount - 3} more...` : '';
    
    return {
      label: `${index + 1}. ${commit.message}`,
      detail: `${fileCount} files: ${filesList}${moreText}`,
      description: commit.body?.split('\n')[0] || '',
      commit
    };
  });

  const selected = await vscode.window.showQuickPick([
    {
      label: `✅ Create ${plan.commits.length} commits`,
      detail: `Total: ${changedFiles.length} files`,
      description: 'Proceed with the plan',
      kind: vscode.QuickPickItemKind.Default
    },
    {
      label: `❌ Cancel`,
      detail: 'Do not create any commits',
      description: 'Cancel operation',
      kind: vscode.QuickPickItemKind.Default  
    },
    {
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    },
    ...items
  ], {
    title: '🤖 Commit Plan Preview',
    placeHolder: 'Review the planned commits and choose an action',
    matchOnDetail: true,
    matchOnDescription: true
  });

  return selected?.label.startsWith('✅') || false;
}

async function addRemainingFiles(repoRoot: string) {
  try {
    const modifiedFiles = await runGit(repoRoot, ["diff", "--name-only"]);
    const untrackedFiles = await runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
    
    console.log(`Auto Commit Splitter: modifiedFiles raw output: "${modifiedFiles}"`);
    console.log(`Auto Commit Splitter: untrackedFiles raw output: "${untrackedFiles}"`);
    
    const allRemainingFiles = [...modifiedFiles.split('\n'), ...untrackedFiles.split('\n')]
      .filter(f => f.trim())
      .filter(f => f);

    console.log(`Auto Commit Splitter: allRemainingFiles processed:`, allRemainingFiles);

    if (allRemainingFiles.length > 0) {
      console.log(`Auto Commit Splitter: Adding ${allRemainingFiles.length} remaining files to staging`);
      for (const file of allRemainingFiles) {
        console.log(`Auto Commit Splitter: About to add file: "${file}"`);
        try {
          await runGit(repoRoot, ["add", file]);
        } catch (error) {
          console.warn(`Failed to add remaining file ${file}:`, error);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to add remaining files:', error);
  }
}

export function deactivate() {}