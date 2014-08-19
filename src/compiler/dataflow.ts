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
        var currentState: State = reachableState();
        var trueState: State;
        var falseState: State;
        var inForkedState: boolean = false;

        function or(s1: State, s2: State): State {
            if (s1.isReachable() === s2.isReachable()) {
                // TODO: combine states
            }
            // in JS states the only possible transition is 'reachable -> unreachable'
            Debug.assert(s1.isReachable() && !s2.isReachable());
            return s1;
        }

        //function and(s1: State, s2: State): State {
        //}

        function fork(newTrueState: State, newFalseState: State): void {
            if (!inForkedState) {
                inForkedState = true;
                currentState = undefined;
                trueState = newTrueState;
                falseState = newFalseState;
            }
        }

        function merge() {
            if (inForkedState) {
                setState(or(trueState, falseState));
            }
        }

        function setState(newState: State) {
            inForkedState = false;
            trueState = falseState = undefined;
            currentState = newState;
        }

        function walk(n: Node) {
            var symbol = context.getSymbolOfNode(n);
            if (n.locals) {
                // register locals
                for (var id in n.locals) {
                    var local = n.locals[id];
                    if (local.flags & SymbolFlags.Variable) {
                        locals.push(local);
                    }
                }
            }
        }

        walk(n);
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