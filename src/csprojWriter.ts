import * as path from 'path';
import * as util from 'util';
import { promises as fs } from 'fs';

const findUpGlob = require('find-up-glob');
const xml2js = require("xml2js");

export enum BuildActions {
    Folder = 'Folder',
    Compile = 'Compile',
    Content = 'Content',
    EmbeddedResource = 'EmbeddedResource',
    PRIResource = 'PRIResource',
    Page = 'Page',
    None = 'None',
}

export class CsProjWriter {
    public async getProjFilePath(filePath: string): Promise<string | undefined> {
        const
            projItems: string[] = await findUpGlob('*.projitems', { cwd: path.dirname(filePath) }),
            csProj: string[] = await findUpGlob('*.csproj', { cwd: path.dirname(filePath) });

        if (projItems !== null && projItems.length >= 1) return projItems[0];
        else if (csProj !== null && csProj.length >= 1) return csProj[0];

        return undefined;
    }

    public async add(projPath: string, itemPath: string, itemType: BuildActions) {
        var buildAction = await this.get(projPath, itemPath);
        if (buildAction !== undefined) await this.remove(projPath, itemPath);

        itemPath = itemPath.replace(path.dirname(projPath) + path.sep, path.extname(projPath) == '.projitems' ? "$(MSBuildThisFileDirectory)" : "");

        const
            xml = await fs.readFile(projPath, 'utf8'),
            xmlParser = util.promisify(new xml2js.Parser().parseString),
            xmlBuilder = new xml2js.Builder();

        let parsedXml = await xmlParser(xml);
        if (parsedXml === undefined || parsedXml.Project === undefined) return;

        let obj = {
            [itemType]: {
                $: {
                    'Include': itemPath
                }
            }
        };

        if (itemType === BuildActions.Compile && itemPath.endsWith('.xaml.cs')) {
            console.log("TRUE")
            var pagePath = itemPath.replace('.cs', '');
            console.log(pagePath)
            var pageBuildAction = await this.get(projPath, pagePath);
            console.log(pageBuildAction)

            if (pageBuildAction === BuildActions.Page) {
                console.log(path.basename(pagePath))
                Object(obj[itemType]).DependentUpon = path.basename(pagePath);
            }
        } else if (itemType === BuildActions.Page) {
            Object(obj[itemType]).SubType = 'Designer';
            Object(obj[itemType]).Generator = 'MSBuild:Compile';
        }

        var items: Array<Object> = parsedXml.Project.ItemGroup;
        items.push(obj);

        await fs.writeFile(projPath, xmlBuilder.buildObject(parsedXml));
    }

    public async get(projPath: string, itemPath: string) : Promise<BuildActions | undefined> {
        itemPath = itemPath.replace(path.dirname(projPath) + path.sep, path.extname(projPath) == '.projitems' ? "$(MSBuildThisFileDirectory)" : "");

        const
            xml = await fs.readFile(projPath, 'utf8'),
            xmlParser = util.promisify(new xml2js.Parser().parseString);

        let parsedXml = await xmlParser(xml);
        if (parsedXml === undefined || parsedXml.Project === undefined) return;
        
        var items: Array<Object> = parsedXml.Project.ItemGroup;

        for (let item of items) {
            var actions: Array<Object> = Object.keys(item).map(key => Object(item)[key])[0];
            for (let action of actions) {
                if (Object(action)["$"].Include === itemPath) return BuildActions[Object.getOwnPropertyNames(item)[0] as keyof typeof BuildActions];
            }
        }

        return undefined;
    }

    public async remove(projPath: string, itemPath: string) {
        itemPath = itemPath.replace(path.dirname(projPath) + path.sep, path.extname(projPath) == '.projitems' ? "$(MSBuildThisFileDirectory)" : "");

        const
            xml = await fs.readFile(projPath, 'utf8'),
            xmlParser = util.promisify(new xml2js.Parser().parseString),
            xmlBuilder = new xml2js.Builder();

        let parsedXml = await xmlParser(xml);
        if (parsedXml === undefined || parsedXml.Project === undefined) return;
        
        var items: Array<Object> = parsedXml.Project.ItemGroup;

        for (let item of items) {
            var actions: Array<Object> = Object.keys(item).map(key => Object(item)[key])[0];
            for (let action of actions) {
                if (Object(action)["$"].Include === itemPath) {
                    actions.splice(actions.indexOf(action), 1);
                    if (actions.length == 0) items.splice(items.indexOf(item), 1);
                }
            }
        }

        await fs.writeFile(projPath, xmlBuilder.buildObject(parsedXml));
    }
}