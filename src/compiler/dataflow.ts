/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="scanner.ts"/>
/// <reference path="parser.ts"/>
/// <reference path="binder.ts"/>
/// <reference path="dataflow.state.ts"/>

module ts.dataflow {
    export interface Context {
        resolveName(name: Identifier): Symbol;
        error(n: Node, message: DiagnosticMessage, arg0?: any) : void;
        getSymbolOfNode(n: Node): Symbol;
    }

    export function checkDataFlowOfFunction(n: FunctionDeclaration, context: Context): void {
        check(n, context);
    }

    function check(n: Node, context: Context): void {
        var locals: Symbol[] = [];

        var env: CheckFlowEnv<State> = {
            isReachable: s => s.isReachable(),
            reachable: () => {
                var s = new State(1);
                s.setReachable(true);
                return s;
            },
            unreachable: () => new State(1),
            uninitialized: (): State => { throw "NYI" },
            isUninitialized: (s: State): boolean => { throw "NYI" },
            or: or,
            error: context.error,
            copy: (s: State): State => { throw "NYI" }
        };

        var walker: CheckFlowWalker<State> = (n, state, base) => {
        };

        checkFlow(n, env, walker);
        return;

        function or(s1: State, s2: State): State {
            throw "NYI";
        }

        //function and(s1: State, s2: State): State {
        //}

    }

    function reachableState() {
        var s = new State(1);
        s.setReachable(true);
        return s;
    }

    function unreachableState() {
        return new State(1);
    }
}