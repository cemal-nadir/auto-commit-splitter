import * as assert from 'assert';
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test('Extension should be present', async () => {
        const extension = vscode.extensions.getExtension('cemalnadir.auto-commit-splitter');
        assert.ok(extension);
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('cemalnadir.auto-commit-splitter');
        if (extension && !extension.isActive) {
            await extension.activate();
        }
        assert.ok(extension?.isActive);
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();
        const extensionCommands = commands.filter(command => command.startsWith('autoCommitSplitter.'));
        assert.ok(extensionCommands.length > 0, 'No extension commands found');
        
        // Test specific commands exist
        assert.ok(commands.includes('autoCommitSplitter.selectModel'), 'selectModel command not found');
        assert.ok(commands.includes('autoCommitSplitter.splitAndCommit'), 'splitAndCommit command not found');
    });
});
