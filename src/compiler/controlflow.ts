/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="scanner.ts"/>
/// <reference path="parser.ts"/>
/// <reference path="binder.ts"/>
/// <reference path="flow.ts"/>

module ts {

    export function checkControlFlowOfFunction(decl: FunctionDeclaration, noImplicitReturns: boolean, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void) {
        if (!decl.body || decl.body.kind !== SyntaxKind.FunctionBlock) {
            return;
        }

        var finalState = checkControlFlow(decl.body, error);
        if (noImplicitReturns && finalState === ControlFlowState.Reachable) {
            var errorNode: Node = decl.name || decl;
            error(errorNode, Diagnostics.Not_all_code_paths_return_a_value);
        }
    }

    export function checkControlFlowOfBlock(block: Block, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void) {
        checkControlFlow(block, error);
    }

    function checkControlFlow(decl: Node, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void): ControlFlowState {
        var env: CheckFlowEnv<ControlFlowState> = {
            uninitialized: () => ControlFlowState.Uninitialized,
            reachable: () => ControlFlowState.Reachable,
            unreachable: () => ControlFlowState.Unreachable,
            isReachable: s => s === ControlFlowState.Reachable,
            isUninitialized: s => s === ControlFlowState.Uninitialized,
            copy: s => s,
            or: or,
            error: error
        };

        var walker: CheckFlowWalker<ControlFlowState> = (n, state, base) => {
            switch (n.kind) {
                case SyntaxKind.WhileStatement:
                case SyntaxKind.DoStatement:
                case SyntaxKind.ForStatement:
                case SyntaxKind.ForInStatement:
                case SyntaxKind.ReturnStatement:
                case SyntaxKind.ThrowStatement:
                case SyntaxKind.BreakStatement:
                case SyntaxKind.ContinueStatement:
                case SyntaxKind.TryStatement:
                case SyntaxKind.SwitchStatement:
                case SyntaxKind.LabelledStatement:
                case SyntaxKind.WithStatement:
                case SyntaxKind.VariableStatement:
                case SyntaxKind.EmptyStatement:
                case SyntaxKind.ExpressionStatement:
                case SyntaxKind.DebuggerStatement:
                    verifyReachable(n, state)
                    break;
            }

            base(n);
        };

        var state = checkFlow(decl, env, walker);
        return state.state;

        function or(s1: ControlFlowState, s2: ControlFlowState): ControlFlowState {
            if (s1 === ControlFlowState.Reachable || s2 === ControlFlowState.Reachable) {
                return ControlFlowState.Reachable;
            }
            if (s1 === ControlFlowState.ReportedUnreachable && s2 === ControlFlowState.ReportedUnreachable) {
                return ControlFlowState.ReportedUnreachable;
            }
            return ControlFlowState.Unreachable;
        }

        function verifyReachable(n: Node, s: CheckFlowState<ControlFlowState>): void {
            if (s.state === ControlFlowState.Unreachable) {
                error(n, Diagnostics.Unreachable_code_detected);
                s.setState(ControlFlowState.ReportedUnreachable);
            }
        }
    }

    enum ControlFlowState {
        Uninitialized       = 0,
        Reachable           = 1,
        Unreachable         = 2,
        ReportedUnreachable = 3,
    }
}