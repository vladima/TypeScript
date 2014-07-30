/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="scanner.ts"/>
/// <reference path="parser.ts"/>
/// <reference path="binder.ts"/>

module ts {
    export function checkFlow(decl: FunctionDeclaration, noImplicitReturns: boolean, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void) {
        if (!decl.body) {
            return;
        }

        var finalState = checkControlFlow(decl, error);
        if (noImplicitReturns && finalState === ControlFlowState.Reachable) {
            error(decl.name || decl, Diagnostics.Not_all_code_paths_return_a_value);
        }
    }

    function checkControlFlow(decl: FunctionDeclaration, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void): ControlFlowState {
        var state = ControlFlowState.Reachable;
        var trueState = ControlFlowState.Default;
        var falseState = ControlFlowState.Default;
        var isInSplit = false;

        function setState(newState: ControlFlowState) {
            trueState = falseState = ControlFlowState.Default;
            state = newState;
            isInSplit = false;
        }

        function setSplitState(newTrue: ControlFlowState, newFalse: ControlFlowState) {
            trueState = newTrue;
            falseState = newFalse;
            state = ControlFlowState.Default;
            isInSplit = true;
        }

        function split() {
            if (!isInSplit) {
                setSplitState(state, state);
            }
        }

        function join() {
            if (isInSplit) {
                setState(combine(trueState, falseState));
                isInSplit = false;
            }
        }

        function combine(s1: ControlFlowState, s2: ControlFlowState): ControlFlowState {
            if (s1 === ControlFlowState.Reachable || s2 === ControlFlowState.Reachable) {
                return ControlFlowState.Reachable;
            }
            if (s1 === ControlFlowState.ReportedUnreachable && s2 === ControlFlowState.ReportedUnreachable) {
                return ControlFlowState.ReportedUnreachable;
            }
            return ControlFlowState.Unreachable;
        }

        function union(s1: ControlFlowState, s2: ControlFlowState): ControlFlowState {
            if (s1 === ControlFlowState.Reachable && s2 === ControlFlowState.Reachable) {
                return ControlFlowState.Reachable;
            }
            if (s1 === ControlFlowState.ReportedUnreachable && s2 === ControlFlowState.ReportedUnreachable) {
                return ControlFlowState.ReportedUnreachable;
            }
            return ControlFlowState.Unreachable;
        }

        function verifyReachable(n: Node): void {
            if (state === ControlFlowState.Unreachable) {
                error(n, Diagnostics.Unreachable_code_detected);
                state = ControlFlowState.ReportedUnreachable;
            }
        }

        function enterCondition(n: Node) {
            if (n.kind === SyntaxKind.TrueKeyword) {
                join();
                setSplitState(state, ControlFlowState.Unreachable);
            }
            else if (n.kind === SyntaxKind.FalseKeyword) {
                join();
                setSplitState(ControlFlowState.Unreachable, state);
            }
            else {
                split();
            }
        }

        // current assumption: only statements affect CF
        function check(n: Node): void {
            if (!n) {
                return;
            }
            switch (n.kind) {
                case SyntaxKind.Block:
                case SyntaxKind.TryBlock:
                case SyntaxKind.CatchBlock:
                case SyntaxKind.FinallyBlock:
                case SyntaxKind.ModuleBlock:
                case SyntaxKind.FunctionBlock:
                    forEach((<Block>n).statements, check);
                    break;
                case SyntaxKind.IfStatement:
                    enterCondition((<IfStatement>n).expression);
                    var savedTrue = trueState;
                    var savedFalse = falseState;

                    setState(savedTrue);
                    check((<IfStatement>n).thenStatement);
                    savedTrue = state;

                    setState(savedFalse);
                    check((<IfStatement>n).elseStatement);

                    state = combine(state, savedTrue);
                    break;
                case SyntaxKind.ReturnStatement:
                case SyntaxKind.ThrowStatement:
                    verifyReachable(n);
                    setState(ControlFlowState.Unreachable);
                    break;
                case SyntaxKind.BreakStatement:
                    verifyReachable(n);
                    setState(ControlFlowState.Unreachable);
                    // TODO: check labels
                    break;
                case SyntaxKind.ContinueStatement:
                    verifyReachable(n);
                    setState(ControlFlowState.Unreachable);
                    // TODO: check labels
                    break;
                case SyntaxKind.VariableStatement:
                case SyntaxKind.EmptyStatement:
                case SyntaxKind.ExpressionStatement:
                case SyntaxKind.DebuggerStatement:
                    verifyReachable(n);
                    break;
                case SyntaxKind.DoStatement:
                    verifyReachable(n);
                    check((<DoStatement>n).statement);
                    break;
                case SyntaxKind.ForInStatement:
                    verifyReachable(n);
                    check((<ForInStatement>n).statement);
                    break;
                case SyntaxKind.ForStatement:
                    verifyReachable(n);
                    check((<ForStatement>n).statement);
                    break;
                case SyntaxKind.LabelledStatement:
                    verifyReachable(n);
                    check((<LabelledStatement>n).statement);
                    break;
                case SyntaxKind.SwitchStatement:
                case SyntaxKind.TryStatement:
                    verifyReachable(n);
                    check((<TryStatement>n).tryBlock);
                    check((<TryStatement>n).catchBlock);
                    check((<TryStatement>n).finallyBlock);
                    break;
                case SyntaxKind.WhileStatement:
                case SyntaxKind.WithStatement:
                    break;
            }
        }

        check(decl.body);
        return state;
    }

    enum ControlFlowState {
        Reachable           = 1,
        Unreachable         = 2,
        ReportedUnreachable = Unreachable | 4,
        Default             = Unreachable
    }
}