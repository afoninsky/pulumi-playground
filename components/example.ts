import * as pulumi from '@pulumi/pulumi'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
}

export default class Example extends olly.ComponentResource {

    private readonly args: Args

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Example, name, args, opts)
        this.args = args
    }
}
